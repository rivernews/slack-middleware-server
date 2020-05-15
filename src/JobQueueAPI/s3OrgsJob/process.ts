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

const asyncCleanUpS3Job = async () => {
    console.log('s3 job clean up supervisor job queue...');
    await supervisorJobQueueManager.asyncCleanUp();

    // best effort scale down selenium resources and nodes
    await asyncSendSlackMessage(
        `S3 work done, best effort scaled down selenium microservice`
    );

    console.log('about to scale down selenium, cool down for 10 seconds');
    await new Promise(res => setTimeout(res, 10 * 1000));

    let scaledownError: Error | undefined;
    try {
        await ScraperNodeScaler.singleton.orderScaleDown();

        console.log('scaled down response', 'cool down for 10 seconds');
        await new Promise(res => setTimeout(res, 10 * 1000));

        await KubernetesService.singleton._cleanScraperWorkerNodePools();
    } catch (error) {
        console.log(error instanceof Error ? error.message : error);
        scaledownError = error;
    }

    const slackRes = await asyncSendSlackMessage(
        `:\n\n\n\`\`\`${
            scaledownError instanceof Error
                ? scaledownError.message
                : JSON.stringify(scaledownError || 'No error')
        }\`\`\`\n`
    );
    console.log('s3 slack request', slackRes.data, slackRes.statusText);
    return;
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

    return (
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
                                    pageNumberPointer < estimatedPageCountTotal
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
                                    pubsubChannelName: getPubsubChannelName({
                                        orgName: org.orgName
                                    }),
                                    orgInfo: org.companyOverviewPageUrl
                                }
                            });
                        }

                        // report progress after job planning complete
                        if (!supervisorJobRequests.length) {
                            progressBarManager.syncSetAbsolutePercentage(100);
                        } else {
                            progressBarManager.syncSetRelativePercentage(
                                0,
                                supervisorJobRequests.length
                            );
                        }

                        return supervisorJobRequests;
                    })
                    .then(scraperJobRequests => {
                        return Promise.all(
                            scraperJobRequests.map(
                                (scraperJobRequest, index) => {
                                    // supervisorJobQueueManager.asyncAdd(
                                    //     scraperJobRequest
                                    // )

                                    JobQueueSharedRedisClientsSingleton.singleton.intialize(
                                        'master'
                                    );
                                    JobQueueSharedRedisClientsSingleton.singleton.subscriberClient
                                        ?.subscribe(
                                            RedisPubSubChannelName.ADMIN
                                        )
                                        .then(count => {
                                            console.log(
                                                's3 subscribe to admin channel successfully; count',
                                                count
                                            );
                                        });

                                    return new Promise<string>((res, rej) => {
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
                                                        error instanceof Error
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
                                                    return res(errorMessage);
                                                }
                                            },
                                            index * 1 * 600
                                        );

                                        JobQueueSharedRedisClientsSingleton.singleton.subscriberClient?.on(
                                            'message',
                                            (
                                                channel: string,
                                                message: string
                                            ) => {
                                                const [
                                                    type,
                                                    messageTo,
                                                    ...payload
                                                ] = message.split(':');
                                                const payloadAsString = payload.join(
                                                    ':'
                                                );

                                                if (
                                                    type ===
                                                    ScraperJobMessageType.TERMINATE
                                                ) {
                                                    clearTimeout(scheduler);
                                                    return res(
                                                        `maunallyTerminated`
                                                    );
                                                }
                                            }
                                        );
                                    });
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
    );
};
