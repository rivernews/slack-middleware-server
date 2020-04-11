import Bull from 'bull';
import { s3ArchiveManager } from '../../services/s3/s3';
import { supervisorJobQueueManager } from '../supervisorJob/queue';
import { s3OrgsJobQueueManager } from './queue';
import { ProgressBarManager } from '../../services/jobQueue/ProgressBar';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { ServerError } from '../../utilities/serverExceptions';
import { SUPERVISOR_JOB_CONCURRENCY } from '../../services/jobQueue/JobQueueManager';
import {
    ScraperJobRequestData,
    ScraperMode
} from '../../services/jobQueue/types';
import { Configuration } from '../../utilities/configuration';
import { getPubsubChannelName } from '../../services/jobQueue/message';

module.exports = function (s3OrgsJob: Bull.Job<null>) {
    console.log(`s3OrgsJob ${s3OrgsJob.id} started`, s3OrgsJob);

    supervisorJobQueueManager.initialize(`s3Org sandbox`, false);
    const supervisorJobQueueManagerQueue = supervisorJobQueueManager.queue;
    if (!supervisorJobQueueManagerQueue) {
        throw new ServerError(
            `In s3Org sandbox process: supervisorJobQueueManager queue not initialized yet`
        );
    }

    const progressBarManager = ProgressBarManager.newProgressBarManager(
        JobQueueName.GD_ORG_REVIEW_S3_ORGS_JOB,
        s3OrgsJob
    );

    return s3OrgsJobQueueManager
        .checkConcurrency(
            // check supervisor job is clean, no existing job
            // since s3 org job could provision lots of supervisor jobs and scraper jobs
            // it could be chaotic to mix s3 job with existing single org job
            // better to limit s3 job to launch only if no supervisor job exists
            1,
            supervisorJobQueueManagerQueue,
            s3OrgsJob,
            JobQueueName.GD_ORG_REVIEW_S3_ORGS_JOB
        )
        .then((supervisorJobsPresentCount: number) => {
            // dispatch supervisors into parallel groups
            const supervisorJobVacancy =
                SUPERVISOR_JOB_CONCURRENCY - supervisorJobsPresentCount;

            console.debug(
                `s3OrgJob: we have ${supervisorJobVacancy} vacancies, will divide orgs into this amount of buckets`
            );

            return (
                s3ArchiveManager
                    .asyncGetAllOrgsForS3Job()
                    // increment progress after s3 org list fetched
                    .then(orgList =>
                        progressBarManager
                            .increment()
                            .then(() => {
                                // TODO: planning job dispatching including splitted jobs
                                const scraperJobRequests: ScraperJobRequestData[] = [];

                                for (const org of orgList) {
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

                                        // dispatch 1st job
                                        scraperJobRequests.push({
                                            pubsubChannelName: getPubsubChannelName(
                                                { orgName: org.orgName }
                                            ),
                                            orgInfo: org.companyOverviewPageUrl,
                                            stopPage:
                                                pageNumberPointer +
                                                incrementalPageAmount
                                        });
                                        pageNumberPointer += incrementalPageAmount;

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
                                            scraperJobRequests.push({
                                                // job splitting params
                                                nextReviewPageUrl: `${
                                                    org.reviewPageUrl
                                                }_P${pageNumberPointer +
                                                    1}.htm`,
                                                stopPage:
                                                    pageNumberPointer +
                                                    incrementalPageAmount,

                                                // other essential params
                                                pubsubChannelName: getPubsubChannelName(
                                                    {
                                                        orgName: org.orgName,
                                                        page:
                                                            pageNumberPointer +
                                                            1
                                                    }
                                                ),
                                                orgId: org.orgId,
                                                orgName: org.orgName,
                                                scrapeMode: ScraperMode.RENEWAL,

                                                // for log and monitor
                                                lastProgress: {
                                                    processed: 0,
                                                    wentThrough: 0,
                                                    total: org.localReviewCount,
                                                    durationInMilli: '1',
                                                    page: pageNumberPointer,
                                                    processedSession: 0
                                                }
                                            });
                                            pageNumberPointer += incrementalPageAmount;
                                        }

                                        // last splitted job does not need stop page, just scrape till the end
                                        delete scraperJobRequests[
                                            scraperJobRequests.length - 1
                                        ].stopPage;

                                        continue;
                                    }

                                    scraperJobRequests.push({
                                        pubsubChannelName: getPubsubChannelName(
                                            { orgName: org.orgName }
                                        ),
                                        orgInfo: org.companyOverviewPageUrl
                                    });
                                }

                                // report progress after job planning complete
                                if (!scraperJobRequests.length) {
                                    progressBarManager.syncSetAbsolutePercentage(
                                        100
                                    );
                                } else {
                                    progressBarManager.syncSetRelativePercentage(
                                        0,
                                        scraperJobRequests.length
                                    );
                                }

                                return scraperJobRequests;
                            })
                            .then(scraperJobRequests => {
                                return Promise.all(
                                    scraperJobRequests.map(
                                        (scraperJobRequest, index) =>
                                            new Promise(res =>
                                                setTimeout(
                                                    res,
                                                    index * 3 * 1000
                                                )
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
            );
        })
        .then((resultList: string[]) => Promise.resolve(resultList))
        .catch((error: Error) => Promise.reject(error))
        .finally(() => {
            return supervisorJobQueueManager.asyncCleanUp();
        });
};
