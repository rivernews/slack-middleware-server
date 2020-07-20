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
    S3JobCleanUpArgs,
    S3JobRequestData
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
import { RuntimeEnvironment } from '../../utilities/runtime';
import axios from 'axios';

const asyncCleanUpS3Job = async ({
    k8sHeadServicekeepAliveScheduler
}: S3JobCleanUpArgs) => {
    console.log('s3 job enter finalizing stage');

    // stop scheduler that keeps k8s head service alive
    if (
        k8sHeadServicekeepAliveScheduler !== undefined &&
        k8sHeadServicekeepAliveScheduler !== null
    ) {
        clearInterval(k8sHeadServicekeepAliveScheduler);
    }

    // have s3 job wait till all supervisor job finished
    // as long as there is still supervisor job, we should never scale down, so keep waiting.
    // such supervisor jobs could be those dispatched by s3 job,
    // re-try from failed supervisor job from s3 job, or created manually from UI
    await new Promise((res, rej) => {
        console.log('waiting for all supervisor jobs finish');
        const scheduler = setInterval(async () => {
            try {
                const jobPresentCount = await supervisorJobQueueManager.checkConcurrency(
                    1,
                    undefined,
                    undefined,
                    undefined,
                    false
                );
                process.stdout.write('.' + jobPresentCount);
                if (jobPresentCount === 0) {
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
                    clearInterval(scheduler);
                    await supervisorJobQueueManager.asyncCleanUp();
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

    await ScraperNodeScaler.singleton.scaleDown().then(async () => {
        try {
            await asyncSendSlackMessage(
                `=== S3 job scaled down node pools, finalize stage complete ===`
            );
        } catch (error) {}
    });
};

const getSplittedJobRequestData = (
    org: S3Organization,
    pageNumberPointer: number,
    incrementalPageAmount: number,
    shardIndex: number,
    jobSplitedSize: number
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
            total: jobSplitedSize,
            durationInMilli: '1',
            page: pageNumberPointer,
            processedSession: 0
        }
    };
};

module.exports = function (s3OrgsJob: Bull.Job<S3JobRequestData>) {
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

                            try {
                                if (!readyNodePool) {
                                    await asyncSendSlackMessage(
                                        `Polling node pool status: \`(No ready node pool yet)\`.`
                                    );
                                } else {
                                    await asyncSendSlackMessage(
                                        'Polling node pool status:\n' +
                                            `\`\`\`${JSON.stringify(
                                                readyNodePool
                                            )}\`\`\`\n`
                                    );
                                }
                            } catch (error) {}

                            if (readyNodePool) {
                                clearInterval(scheduler);

                                console.log(
                                    'nodes are ready, next is to create selenium base...'
                                );

                                // create selenium base
                                await ScraperNodeScaler.singleton.orderSeleniumBaseProvisioning();

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
        .then(async () => {
            try {
                return await asyncSendSlackMessage(
                    `Now proceed s3 job dispatching, s3 job data:\n\`\`\`${JSON.stringify(
                        s3OrgsJob.data || 'Null'
                    )}\`\`\` `
                );
            } catch {}
        })
        .then(() => {
            // keep alive for k8s head service hosted on Heroku
            // we're polling per 60 seconds, but should be just fine at least polling once for an hour
            const k8sHeadServicekeepAliveScheduler = s3OrgsJob.data
                ?.keepAliveK8sHeadService
                ? setInterval(async () => {
                      try {
                          await axios.get(
                              process.env.NODE_ENV ===
                                  RuntimeEnvironment.DEVELOPMENT
                                  ? `http://host.docker.internal:3010/`
                                  : `https://k8s-cluster-head-service.herokuapp.com/`
                          );
                      } catch (error) {}
                  }, 60 * 1000)
                : undefined;

            return (
                s3ArchiveManager
                    .asyncGetAllOrgsForS3Job()
                    // increment progress after s3 org list fetched
                    .then(orgList =>
                        progressBarManager
                            .increment()
                            .then(async () => {
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
                                        const jobSplitedSize =
                                            incrementalPageAmount *
                                            Configuration.singleton
                                                .gdReviewCountPerPage;
                                        let pageNumberPointer = 0;
                                        let shardIndex = 0;

                                        // dispatch 1st job
                                        supervisorJobRequests.push({
                                            splittedScraperJobRequestData: getSplittedJobRequestData(
                                                org,
                                                pageNumberPointer,
                                                incrementalPageAmount,
                                                shardIndex,
                                                jobSplitedSize
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
                                                    shardIndex,
                                                    jobSplitedSize
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

                                        // correct last splitted job to use the remained value
                                        ((supervisorJobRequests[
                                            supervisorJobRequests.length - 1
                                        ]
                                            .splittedScraperJobRequestData as ScraperJobRequestData)
                                            .lastProgress as ScraperProgressData).total =
                                            org.localReviewCount %
                                            jobSplitedSize;

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
                                try {
                                    if (!supervisorJobRequests.length) {
                                        await progressBarManager.syncSetAbsolutePercentage(
                                            100
                                        );
                                    } else {
                                        await progressBarManager.syncSetRelativePercentage(
                                            0,
                                            supervisorJobRequests.length
                                        );
                                    }
                                } catch (error) {}

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

                                                                return res(
                                                                    result
                                                                );
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
                                                            Configuration
                                                                .singleton
                                                                .s3DispatchJobIntervalMs
                                                    );

                                                    // terminate all jobs when signaled from pubsub
                                                    JobQueueSharedRedisClientsSingleton.singleton.onTerminate(
                                                        () => {
                                                            clearTimeout(
                                                                scheduler
                                                            );
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
                    .then(async (resultList: string[]) => {
                        await asyncCleanUpS3Job({
                            k8sHeadServicekeepAliveScheduler
                        });
                        return resultList;
                    })
                    .catch(async (error: Error) => {
                        await asyncCleanUpS3Job({
                            k8sHeadServicekeepAliveScheduler
                        });
                        throw error;
                    })
            );
        })
        .catch(error => {
            // s3 job failed to initialize
            throw error;
        });
};
