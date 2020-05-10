import Bull from 'bull';
import { s3ArchiveManager } from '../../services/s3';
import { supervisorJobQueueManager } from '../supervisorJob/queue';
import { ProgressBarManager } from '../../services/jobQueue/ProgressBar';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import {
    ScraperJobRequestData,
    ScraperMode,
    SupervisorJobRequestData,
    ScraperProgressData
} from '../../services/jobQueue/types';
import { Configuration } from '../../utilities/configuration';
import { getPubsubChannelName } from '../../services/jobQueue/message';
import { getMiddleReviewPageUrl } from '../../services/gd';
import { S3Organization } from '../../services/s3/types';
import { asyncSendSlackMessage } from '../../services/slack';
import { ScraperNodeScaler } from '../../services/kubernetes/kubernetesScaling';
import { KubernetesService } from '../../services/kubernetes/kubernetes';

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
                            scraperJobRequests.map((scraperJobRequest, index) =>
                                // supervisorJobQueueManager.asyncAdd(
                                //     scraperJobRequest
                                // )
                                new Promise(res =>
                                    setTimeout(res, index * 1 * 600)
                                ).then(() => {
                                    return supervisorJobQueueManager.asyncAdd(
                                        scraperJobRequest
                                    );
                                })
                            )
                        );
                    })
            )
            .then(supervisorJobList =>
                Promise.all(
                    supervisorJobList.map(supervisorJob =>
                        supervisorJob
                            .finished()
                            // increment progress after job finished, then propogate back job result
                            .then((result: string) =>
                                progressBarManager
                                    .increment()
                                    .then(() => result)
                            )
                    )
                )
            )
            .then((resultList: string[]) => Promise.resolve(resultList))
            .catch((error: Error) => Promise.reject(error))
            .finally(async () => {
                console.log('cool down for 30 seconds');
                await new Promise(res => setTimeout(res, 30 * 1000));

                let scaledownError;
                try {
                    await ScraperNodeScaler.singleton.orderScaleDown();

                    console.log('cool down for 20 seconds');
                    await new Promise(res => setTimeout(res, 20 * 1000));

                    await KubernetesService.singleton._cleanScraperWorkerNodePools();
                } catch (error) {
                    console.log(error);
                    scaledownError = error;
                }
                const slackRes = await asyncSendSlackMessage(
                    `S3 work done, best effort scaled down selenium microservice:\n\n\n\`\`\`${
                        scaledownError instanceof Error
                            ? scaledownError.message
                            : JSON.stringify(scaledownError || 'No error')
                    }\`\`\``
                );
                console.log(slackRes.data, slackRes.statusText);
                return await supervisorJobQueueManager.asyncCleanUp();
            })
    );
};
