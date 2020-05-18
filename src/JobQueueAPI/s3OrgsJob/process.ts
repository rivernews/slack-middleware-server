import Bull from 'bull';
import { s3ArchiveManager } from '../../services/s3';
import { supervisorJobQueueManager } from '../supervisorJob/queue';
import { ProgressBarManager } from '../../services/jobQueue/ProgressBar';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import {
    ScraperJobRequestData,
    ScraperMode,
    SupervisorJobRequestData,
    ScraperProgressData,
    ScraperJobMessageType
} from '../../services/jobQueue/types';
import { Configuration } from '../../utilities/configuration';
import { getPubsubChannelName } from '../../services/jobQueue/message';
import { getMiddleReviewPageUrl } from '../../services/gd';
import { S3Organization } from '../../services/s3/types';
import { asyncSendSlackMessage } from '../../services/slack';
import { ScraperNodeScaler } from '../../services/kubernetes/kubernetesScaling';
import { KubernetesService } from '../../services/kubernetes/kubernetes';
import {
    JobQueueSharedRedisClientsSingleton,
    RedisPubSubChannelName
} from '../../services/redis';
import { SeleniumArchitectureType } from '../../services/kubernetes/types';

const asyncCleanUpS3Job = async () => {
    console.log('s3 job enter finalizing stage');

    // TODO: remove this when we don't need s3 to wait till all supervisor job
    // perhaps created by s3 job or created manually be re-try or other source to complete
    //
    // as long as there is still supervisor job, we should never scale down so keep waiting
    await new Promise((res, rej) => {
        console.log('waiting for all supervisor jobs finish');
        const scheduler = setInterval(async () => {
            try {
                const vacancy = await supervisorJobQueueManager.checkConcurrency(
                    1,
                    undefined,
                    undefined,
                    undefined,
                    false
                );
                process.stdout.write('.' + vacancy);
                if (vacancy === 0) {
                    console.log('s3 job clean up supervisor job queue...');
                    await supervisorJobQueueManager.asyncCleanUp();
                    clearInterval(scheduler);
                    return res();
                }
            } catch (error) {
                if (
                    typeof error === 'string' &&
                    error.includes('concurrency limit')
                ) {
                    // no vacancy, which means stil some supervisor job running
                    // so let's wait till them finish
                    return;
                }

                // sth is wrong, don't wait just abort s3 job
                await supervisorJobQueueManager.asyncCleanUp();
                clearInterval(scheduler);
                return res();
            }
        }, 5 * 1000);

        try {
            JobQueueSharedRedisClientsSingleton.singleton.onTerminate(
                async () => {
                    console.log(
                        's3 job receives terminate signal while finalizing, will now force proceeding clean up'
                    );
                    await supervisorJobQueueManager.asyncCleanUp();
                    clearInterval(scheduler);
                    return res(`maunallyTerminated`);
                }
            );
        } catch (error) {
            rej(error);
        }
    });

    // cool down

    try {
        const res = await asyncSendSlackMessage(
            `S3 work done, best effort scaled down selenium microservice`
        );
    } catch (error) {
        console.log(
            error instanceof Error ? error.message : error,
            'slack request failed'
        );
    }

    console.log('about to scale down selenium, cool down for 10 seconds');
    await new Promise(res => setTimeout(res, 10 * 1000));

    // best effort scale down selenium resources and nodes

    await ScraperNodeScaler.singleton.scaleDown();
};

const getSplittedJobRequestData = (
    org: S3Organization,
    pageNumberPointer: number,
    incrementalPageAmount: number,
    shardIndex: number
) => {
    return {
        // job splitting params
        nextReviewPageUrl: getMiddleReviewPageUrl(
            org.reviewPageUrl,
            pageNumberPointer + 1
        ),
        stopPage: pageNumberPointer + incrementalPageAmount,

        // other essential params
        pubsubChannelName: getPubsubChannelName({
            orgName: org.orgName,
            page: pageNumberPointer + 1
        }),
        orgId: org.orgId,
        orgName: org.orgName,
        scrapeMode: ScraperMode.RENEWAL,

        // for log and monitor
        shardIndex,
        lastProgress: {
            processed: 0,
            wentThrough: 0,
            total:
                incrementalPageAmount *
                Configuration.singleton.gdReviewCountPerPage,
            durationInMilli: '1',
            page: pageNumberPointer,
            processedSession: 0
        }
    };
};

module.exports = function (s3OrgsJob: Bull.Job<null>) {
    console.log(`s3OrgsJob ${s3OrgsJob.id} started`, s3OrgsJob);

    supervisorJobQueueManager.initialize(`s3Org sandbox`, false);

    const progressBarManager = ProgressBarManager.newProgressBarManager(
        JobQueueName.GD_ORG_REVIEW_S3_ORGS_JOB,
        s3OrgsJob
    );

    // register pubsub for job termination
    JobQueueSharedRedisClientsSingleton.singleton.intialize('s3Org');
    JobQueueSharedRedisClientsSingleton.singleton.subscriberClient
        ?.subscribe(RedisPubSubChannelName.ADMIN)
        .then(count => {
            console.log(
                's3 subscribed to admin channel successfully; count',
                count
            );
        });

    // first check if there's any node pool created
    return KubernetesService.singleton
        .getReadyNodePool('scraperWorker')
        .then(async readyNodePool => {
            // make sure node pool is created
            if (!readyNodePool) {
                const res = await KubernetesService.singleton._createScraperWorkerNodePool(
                    Configuration.singleton.autoDigitaloceanDropletSize
                );
                console.log(res.size, 'node pool created');
            }

            // polling till all nodes in pool ready
            return await new Promise(
                (resolvePollingPromise, rejectPollingPromise) => {
                    console.log('polling node and selenium stack readiness');
                    const scheduler = setInterval(async () => {
                        try {
                            const readyNodePool = await KubernetesService.singleton.getReadyNodePool(
                                'scraperWorker',
                                true
                            );
                            if (readyNodePool) {
                                console.log(
                                    'nodes are ready, next is to create selenium base...'
                                );

                                // create selenium base
                                const res = await ScraperNodeScaler.singleton.orderSeleniumBaseProvisioning();

                                // if pod-standalone architecuture, then no need to wait for additional resources
                                if (
                                    Configuration.singleton
                                        .seleniumArchitectureType ===
                                    SeleniumArchitectureType['pod-standalone']
                                ) {
                                    // wait for 10 seconds to cool down
                                    console.log(
                                        'selenium base created, cooling down before starting s3...'
                                    );
                                    await new Promise(res =>
                                        setTimeout(res, 10 * 1000)
                                    );
                                } else if (
                                    Configuration.singleton
                                        .seleniumArchitectureType ===
                                    SeleniumArchitectureType['hub-node']
                                ) {
                                    // TODO:
                                    // if node-chrome architecture, need to further deploy chrome nodes and
                                    // wait for 1) hub deployment 2) all chrome nodes deployment status
                                    // to be 'has minimum availability'
                                    await ScraperNodeScaler.singleton.orderSeleniumChromeNodeProvisioning();
                                    // here we just blindly wait for 5 minutes, but ideally we want to
                                    // do polling and see deployments are ready
                                    console.log(
                                        'nodes are ready, selenium base and chrome node deployment created. Wait 5 minutes before starting s3 job'
                                    );
                                    await new Promise(res =>
                                        setTimeout(res, 5 * 60 * 1000)
                                    );
                                } else {
                                    // unknown selenium archi type, move forward anyway
                                    console.log(
                                        'unknown selenium archi type, s3 job move forward anyway'
                                    );
                                }

                                clearInterval(scheduler);
                                return resolvePollingPromise();
                            }

                            process.stdout.write('.');
                        } catch (error) {
                            clearInterval(scheduler);
                            throw error;
                        }
                    }, 10 * 1000);

                    try {
                        JobQueueSharedRedisClientsSingleton.singleton.onTerminate(
                            () => {
                                clearInterval(scheduler);
                                return resolvePollingPromise(
                                    `manuallyTerminated`
                                );
                            }
                        );
                    } catch (error) {
                        clearInterval(scheduler);
                        return rejectPollingPromise(
                            `failed to register redis termination signal while polling node pool in s3 job`
                        );
                    }
                }
            );
        })
        .then(() =>
            s3ArchiveManager
                .asyncGetAllOrgsForS3Job()
                // increment progress after s3 org list fetched
                .then(orgList =>
                    progressBarManager
                        .increment()
                        .then(() => {
                            const supervisorJobRequests: SupervisorJobRequestData[] = [];
                            for (const org of orgList) {
                                // dispatch for large org (splitted job)

                                if (
                                    org.reviewPageUrl &&
                                    org.localReviewCount &&
                                    org.localReviewCount >
                                        Configuration.singleton
                                            .scraperJobSplittingSize
                                ) {
                                    const incrementalPageAmount = Math.ceil(
                                        Configuration.singleton
                                            .scraperJobSplittingSize /
                                            Configuration.singleton
                                                .gdReviewCountPerPage
                                    );
                                    let pageNumberPointer = 0;
                                    let shardIndex = 0;

                                    // dispatch 1st job
                                    supervisorJobRequests.push({
                                        splittedScraperJobRequestData: getSplittedJobRequestData(
                                            org,
                                            pageNumberPointer,
                                            incrementalPageAmount,
                                            shardIndex
                                        )
                                    });

                                    pageNumberPointer += incrementalPageAmount;
                                    shardIndex += 1;

                                    // dispatch rest of the parts
                                    const estimatedPageCountTotal = Math.ceil(
                                        org.localReviewCount /
                                            Configuration.singleton
                                                .gdReviewCountPerPage
                                    );

                                    while (
                                        pageNumberPointer <
                                        estimatedPageCountTotal
                                    ) {
                                        supervisorJobRequests.push({
                                            splittedScraperJobRequestData: getSplittedJobRequestData(
                                                org,
                                                pageNumberPointer,
                                                incrementalPageAmount,
                                                shardIndex
                                            )
                                        });

                                        pageNumberPointer += incrementalPageAmount;
                                        shardIndex += 1;
                                    }

                                    // last splitted job does not need stop page, just scrape till the end
                                    delete (supervisorJobRequests[
                                        supervisorJobRequests.length - 1
                                    ]
                                        .splittedScraperJobRequestData as ScraperJobRequestData)
                                        .stopPage;
                                    // let last splitted job just use local review count instead of incremental amount
                                    // since it may vary
                                    ((supervisorJobRequests[
                                        supervisorJobRequests.length - 1
                                    ]
                                        .splittedScraperJobRequestData as ScraperJobRequestData)
                                        .lastProgress as ScraperProgressData).total =
                                        org.localReviewCount;

                                    continue;
                                }

                                // dispatch for small org that does not need splitting

                                supervisorJobRequests.push({
                                    scraperJobRequestData: {
                                        pubsubChannelName: getPubsubChannelName(
                                            {
                                                orgName: org.orgName
                                            }
                                        ),
                                        orgInfo: org.companyOverviewPageUrl
                                    }
                                });
                            }

                            // report progress after job planning complete
                            if (!supervisorJobRequests.length) {
                                progressBarManager.syncSetAbsolutePercentage(
                                    100
                                );
                            } else {
                                progressBarManager.syncSetRelativePercentage(
                                    0,
                                    supervisorJobRequests.length
                                );
                            }

                            return supervisorJobRequests;
                        })
                        .then(scraperJobRequests => {
                            // dispatch job and wait for job complete
                            return Promise.all(
                                scraperJobRequests.map(
                                    (scraperJobRequest, index) => {
                                        return new Promise<string>(
                                            (res, rej) => {
                                                const scheduler = setTimeout(
                                                    async () => {
                                                        try {
                                                            const job = await supervisorJobQueueManager.asyncAdd(
                                                                scraperJobRequest
                                                            );
                                                            const result: string = await job.finished();

                                                            await progressBarManager.increment();

                                                            return res(result);
                                                        } catch (error) {
                                                            let errorMessage: string;

                                                            if (
                                                                error instanceof
                                                                Error
                                                            ) {
                                                                errorMessage =
                                                                    error.message;
                                                            } else if (
                                                                typeof error ===
                                                                'string'
                                                            ) {
                                                                errorMessage = error;
                                                            } else {
                                                                errorMessage = JSON.stringify(
                                                                    error || {
                                                                        message:
                                                                            'empty error'
                                                                    }
                                                                );
                                                            }

                                                            // if it's a manual termination request, withdraw this s3 job
                                                            // otherwise let us keep waiting other remaining job's .finished() to resolve
                                                            const normalizedText = errorMessage.toLowerCase();
                                                            if (
                                                                normalizedText.includes(
                                                                    'manual'
                                                                ) &&
                                                                normalizedText.includes(
                                                                    'terminate'
                                                                )
                                                            ) {
                                                                return rej(
                                                                    new Error(
                                                                        errorMessage
                                                                    )
                                                                );
                                                            }

                                                            // s3 job move on anyway
                                                            await progressBarManager.increment();
                                                            return res(
                                                                errorMessage
                                                            );
                                                        }
                                                    },
                                                    index *
                                                        Configuration.singleton
                                                            .s3DispatchJobIntervalMs
                                                );

                                                // terminate all jobs when signaled from pubsub
                                                JobQueueSharedRedisClientsSingleton.singleton.onTerminate(
                                                    () => {
                                                        clearTimeout(scheduler);
                                                        return res(
                                                            `maunallyTerminated`
                                                        );
                                                    }
                                                );
                                            }
                                        );
                                    }
                                )
                            );
                        })
                )
                // .then(supervisorJobList =>
                //     Promise.all(
                //         supervisorJobList.map(supervisorJob => {
                //             return new Promise<string>((res, rej) => {
                //                 // note: if job is removed (like when in waiting state), .finish() won't resolve and s3 job will get stuck!
                //                 // https://github.com/OptimalBits/bull/issues/1371
                //                 supervisorJob
                //                     .finished()
                //                     .then(async result => {
                //                         console.log('fnish() -> then()');
                //                         await progressBarManager.increment();
                //                         return res(result);
                //                     })
                //                     .catch(async error => {
                //                         console.log('fnish() -> catch()');

                //                         let errorMessage: string;

                //                         if (error instanceof Error) {
                //                             errorMessage = error.message;
                //                         } else if (typeof error === 'string') {
                //                             errorMessage = error;
                //                         } else {
                //                             errorMessage = JSON.stringify(
                //                                 error || { message: 'empty error' }
                //                             );
                //                         }

                //                         // if it's a manual termination request, withdraw this s3 job
                //                         // otherwise let us keep waiting other remaining job's .finished() to resolve
                //                         const normalizedText = errorMessage.toLowerCase();
                //                         if (
                //                             normalizedText.includes('manual') &&
                //                             normalizedText.includes('terminate')
                //                         ) {
                //                             return rej(new Error(errorMessage));
                //                         }

                //                         // s3 job move on anyway
                //                         await progressBarManager.increment();
                //                         return res(errorMessage);
                //                     });
                //             });
                //         })
                //     )
                // )
                .then(async (resultList: string[]) => {
                    await asyncCleanUpS3Job();
                    return resultList;
                })
                .catch(async (error: Error) => {
                    await asyncCleanUpS3Job();
                    throw error;
                })
        )
        .catch(error => {
            // s3 job failed to initialize
            throw error;
        });
};
