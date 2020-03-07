import Bull from 'bull';
import { gdOrgReviewScraperJobQueueManager } from '../scraperJob/queue';
import {
    ScraperCrossRequest,
    SupervisorJobRequestData,
    ScraperJobReturnData,
    ScraperJobRequestData
} from '../../services/jobQueue/types';
import { ServerError } from '../../utilities/serverExceptions';
import { SUPERVISOR_JOB_CONCURRENCY } from '../../services/jobQueue';
import { asyncSendSlackMessage } from '../../services/slack';
import { supervisorJobQueueManager } from './queue';
import { ProgressBarManager } from '../../services/jobQueue/ProgressBar';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';

const processRenewalJob = async (
    scraperJobResult: ScraperJobReturnData,
    orgFirstJob?: Bull.Job<ScraperJobRequestData>
) => {
    if (!gdOrgReviewScraperJobQueueManager.queue) {
        throw new ServerError(
            `gdOrgReviewScraperJobQueueManager queue not yet initialized`
        );
    }

    if (!ScraperCrossRequest.isScraperCrossRequestData(scraperJobResult)) {
        return;
    }

    const logPrefix = orgFirstJob
        ? `supervisorJob: org job ${orgFirstJob.id}:`
        : 'supervisorJob:';

    let jobResult = new ScraperCrossRequest(scraperJobResult);

    do {
        console.log(`${logPrefix} dispatching renewal job`);
        const renewalJob = await gdOrgReviewScraperJobQueueManager.queue.add(
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

    if (!gdOrgReviewScraperJobQueueManager.queue) {
        throw new ServerError(
            `gdOrgReviewScraperJobQueueManager queue not yet initialized`
        );
    }

    const gdOrgReviewScraperJobQueueManagerQueue =
        gdOrgReviewScraperJobQueueManager.queue;

    const orgInfoList = supervisorJob.data.orgInfo
        ? [supervisorJob.data.orgInfo]
        : supervisorJob.data.orgInfoList || [];
    let processed = 0;

    const progressBar = new ProgressBarManager(
        JobQueueName.GD_ORG_REVIEW_SUPERVISOR_JOB,
        supervisorJob,
        supervisorJob.data.crossRequestData ? 1 : orgInfoList.length
    );

    return supervisorJobQueueManager
        .checkConcurrency(SUPERVISOR_JOB_CONCURRENCY, undefined, supervisorJob)
        .then(() => {
            return progressBar.setAbsolutePercentage(1);
        })
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

            // start dispatching job - scrape from beginning
            if (!orgInfoList.length) {
                console.log('org list empty, will do nothing');
                return Promise.resolve('empty orgList');
            }
            console.log('supervisorJob will dispatch scraper jobs');
            for (processed = 0; processed < orgInfoList.length; processed++) {
                const orgInfo = orgInfoList[processed];
                const orgFirstJob = await gdOrgReviewScraperJobQueueManagerQueue.add(
                    {
                        orgInfo
                    }
                );
                console.log(
                    `supervisorJob added scraper job ${orgFirstJob.id}`
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
                }

                // process renewal jobs if necessary
                await processRenewalJob(orgFirstJobReturnData, orgFirstJob);

                console.log('supervisorJob: proceeding to next org');

                await progressBar.increment();
            }

            console.log(
                'supervisorJob finish dispatching & waiting all jobs done'
            );

            return Promise.resolve('supervisorJob complete successfully');
        })
        .catch(async error => {
            console.log(
                'supervisorJob interrupted due to error\n',
                error,
                'remaining orgList not yet finished (including failed one):',
                orgInfoList.slice(processed, orgInfoList.length)
            );
            await gdOrgReviewScraperJobQueueManagerQueue.empty();
            return Promise.reject(error);
        });
};
