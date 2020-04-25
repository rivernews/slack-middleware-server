import Bull from 'bull';
import { gdOrgReviewScraperJobQueueManager } from '../scraperJob/queue';
import {
    ScraperCrossRequest,
    SupervisorJobRequestData,
    ScraperJobReturnData,
    ScraperJobRequestData
} from '../../services/jobQueue/types';
import { ServerError } from '../../utilities/serverExceptions';
import { asyncSendSlackMessage } from '../../services/slack';
import { ProgressBarManager } from '../../services/jobQueue/ProgressBar';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { SCRAPER_JOB_POOL_MAX_CONCURRENCY } from '../../services/jobQueue/JobQueueManager';
import { getPubsubChannelName } from '../../services/jobQueue/message';

const handleManualTerminationForSupervisorJob = (jobResult: string) => {
    // treat manual termianation as failure at the supervisorJob level
    // (but treat as success at scraper level)
    const tokens = jobResult.split(':');
    if (tokens.length > 1 && tokens[1] === 'manuallyTerminated') {
        throw new Error(jobResult);
    }
};

const processRenewalJob = async (
    scraperJobResult: ScraperJobReturnData,
    orgFirstJob?: Bull.Job<ScraperJobRequestData>
) => {
    if (!gdOrgReviewScraperJobQueueManager.queue) {
        throw new ServerError(
            `In supervisorJob processor subroutines: gdOrgReviewScraperJobQueueManager queue not yet initialized`
        );
    }

    if (!ScraperCrossRequest.isScraperCrossRequestData(scraperJobResult)) {
        return;
    }

    const logPrefix = orgFirstJob
        ? `supervisorJob: org job ${orgFirstJob.id}:`
        : 'supervisorJob:';

    let jobResult: ScraperJobReturnData = new ScraperCrossRequest(
        scraperJobResult
    );

    do {
        console.log(`${logPrefix} dispatching renewal job`);
        const renewalJob: Bull.Job<ScraperJobRequestData> = await gdOrgReviewScraperJobQueueManager.asyncAdd(
            jobResult
        );

        // wait for all renewal job done
        console.log(`${logPrefix} renewal job ${renewalJob.id} started.`);
        jobResult = await renewalJob.finished();

        // validate job result
        if (
            typeof jobResult !== 'string' &&
            !ScraperCrossRequest.isScraperCrossRequestData(jobResult)
        ) {
            throw new ServerError(
                `${logPrefix} returned illegal result data: ${JSON.stringify(
                    jobResult
                )}`
            );
        } else if (typeof jobResult === 'string') {
            handleManualTerminationForSupervisorJob(jobResult);
        }

        console.log(`${logPrefix} renewal job ${renewalJob.id} finished`);
        await asyncSendSlackMessage(
            `${logPrefix} renewal job ${
                renewalJob.id
            } finished, return data:\n\`\`\`${JSON.stringify(jobResult)}\`\`\``
        );
    } while (ScraperCrossRequest.isScraperCrossRequestData(jobResult));

    return;
};

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

/**
 * Main goal for this process is to schedule jobs on the right time.
 * This process will just keep dispatching jobs for each orgs,
 * will not do any check or follow up after spawning these jobs.
 *
 * To view all the queued jobs, you can use the UI.
 *
 */
module.exports = function (supervisorJob: Bull.Job<SupervisorJobRequestData>) {
    console.log(
        'supervisorJob started processing, with params',
        supervisorJob.data
    );

    // supervisorJob will need the following queues to be initialized:
    // supervisorJobQueue
    // gdOrgReviewScraperJobQueue
    //
    // even if you've already initialized them in master process (the one w/ express server), this sandbox process is a completely separate process
    // and does not share any object or resources with master process, thus having to initialize here again (some cross-process functionalities like job.progress()
    // are handled by bull, using nodejs process.send/on('message') to communicate via serialized data)
    gdOrgReviewScraperJobQueueManager.initialize(`supervisor sandbox`, false);
    // supervisorJobQueueManager.initialize();
    if (!gdOrgReviewScraperJobQueueManager.queue) {
        throw new ServerError(
            `gdOrgReviewScraperJobQueueManager queue not yet initialized`
        );
    }

    const progressBarManager = ProgressBarManager.newProgressBarManager(
        JobQueueName.GD_ORG_REVIEW_SUPERVISOR_JOB,
        supervisorJob,
        1
    );

    return (
        gdOrgReviewScraperJobQueueManager
            .checkConcurrency(
                SCRAPER_JOB_POOL_MAX_CONCURRENCY,
                undefined,
                supervisorJob,
                JobQueueName.GD_ORG_REVIEW_SUPERVISOR_JOB
            )
            .then(async () => {
                // start dispatching job - resume scraping
                if (supervisorJob.data.crossRequestData) {
                    if (
                        !ScraperCrossRequest.isScraperCrossRequestData(
                            supervisorJob.data.crossRequestData
                        )
                    ) {
                        throw new ServerError(
                            `Illegal crossRequestData for supervisorJobData: ${JSON.stringify(
                                supervisorJob.data.crossRequestData
                            )}`
                        );
                    }
                    return await processRenewalJob(
                        supervisorJob.data.crossRequestData
                    );
                }

                // start dispatching job - scrape from beginning for unsplitted/splitted single org job

                const scraperJobRequestData: ScraperJobRequestData | undefined =
                    supervisorJob.data.splittedScraperJobRequestData ||
                    supervisorJob.data.scraperJobRequestData;
                if (!scraperJobRequestData) {
                    console.log('No org passed in');
                    return Promise.resolve(
                        `Empty org info, supervisor job ${supervisorJob.id} will do nothing`
                    );
                }

                console.log('supervisorJob will dispatch scraper jobs');

                const orgFirstJob = await gdOrgReviewScraperJobQueueManager.asyncAdd(
                    scraperJobRequestData
                );
                console.log(
                    `supervisorJob ${supervisorJob.id}: added scraper job ${orgFirstJob.id}`
                );

                const orgFirstJobReturnData: ScraperJobReturnData = await orgFirstJob.finished();
                console.log(`supervisorJob: job ${orgFirstJob.id} finished`);
                await asyncSendSlackMessage(
                    `supervisorJob: job ${
                        orgFirstJob.id
                    } finished, return data:\n\`\`\`${JSON.stringify(
                        orgFirstJobReturnData
                    )}\`\`\``
                );

                if (
                    typeof orgFirstJobReturnData !== 'string' &&
                    !ScraperCrossRequest.isScraperCrossRequestData(
                        orgFirstJobReturnData
                    )
                ) {
                    throw new ServerError(
                        `supervisorJob: job ${
                            orgFirstJob.id
                        } returned illegal result data: ${JSON.stringify(
                            orgFirstJobReturnData
                        )}`
                    );
                } else if (typeof orgFirstJobReturnData === 'string') {
                    handleManualTerminationForSupervisorJob(
                        orgFirstJobReturnData
                    );
                }

                // process renewal jobs if necessary
                await processRenewalJob(orgFirstJobReturnData, orgFirstJob);

                console.log('supervisorJob: proceeding to next org');

                await progressBarManager.increment();

                console.log('supervisorJob: all scraper job finished');

                return `supervisorJob ${supervisorJob.id} OK`;
            })
            .catch((error: Error) => {
                console.log(
                    `supervisorJob ${
                        supervisorJob.id
                    } interrupted due to error (job params: ${JSON.stringify(
                        supervisorJob.data
                    )})\n`,
                    error
                );

                throw error;
            })
            // clean up job queue resources created in this sandbox process
            .finally(() => {
                // TODO: remove this if queue is correctly cleaned up
                // return asyncCleanupJobQueuesAndRedisClients({
                //     processName: `${JobQueueName.GD_ORG_REVIEW_SUPERVISOR_JOB} sandbox process`
                // });
                return gdOrgReviewScraperJobQueueManager.asyncCleanUp();
            })
    );
};
