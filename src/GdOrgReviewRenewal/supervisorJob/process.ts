import Bull = require('bull');
import { gdOrgReviewScraperJobQueue } from '../scraperJob/queue';
import {
    ScraperCrossRequest,
    ScraperCrossRequestData,
    SupervisorJobRequestData
} from '../../services/jobQueue/types';
import { s3ArchiveManager } from '../../services/s3';
import { toPercentageValue } from '../../utilities/runtime';
import { ServerError } from '../../utilities/serverExceptions';
import { SUPERVISOR_JOB_CONCURRENCY } from '../../services/jobQueue';

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

    const orgInfoList = supervisorJob.data.orgInfo
        ? [supervisorJob.data.orgInfo]
        : supervisorJob.data.orgInfoList || [];
    let processed = 0;

    return Promise.all([
        gdOrgReviewScraperJobQueue.getWaitingCount(),
        gdOrgReviewScraperJobQueue.getDelayedCount(),
        gdOrgReviewScraperJobQueue.getPausedCount(),
        gdOrgReviewScraperJobQueue.getActiveCount()
    ])
        .then(([waiting, delayed, paused, active]) => {
            const jobsPresentCount = waiting + delayed + paused + active;
            if (jobsPresentCount > SUPERVISOR_JOB_CONCURRENCY) {
                // there's pending job still in the scraper job queue,
                // let previous pending jobs finish first.
                // ignore this supervisorJob (schedule job upon next supervisorJob)
                console.warn(
                    'Previous pending scraper jobs exist, will ignore this supervisorJob'
                );
                return Promise.reject('supervisorJob skip');
            }

            supervisorJob.progress(supervisorJob.progress() + 1);

            return Promise.resolve();
        })
        .then(async () => {
            // get orgList from s3
            // try {
            //     orgInfoList = await getOrgListFromS3();
            //     supervisorJob.progress(supervisorJob.progress() + 1);
            // } catch (error) {
            //     return Promise.reject(error);
            // }

            // dispatch job
            if (!orgInfoList.length) {
                console.log('org list empty, will do nothing');
                return Promise.resolve('empty orgList');
            }
            console.log('supervisorJob will dispatch scraper jobs');
            for (processed = 0; processed < orgInfoList.length; processed++) {
                const orgInfo = orgInfoList[processed];
                let scraperJob = await gdOrgReviewScraperJobQueue.add({
                    orgInfo
                });
                const orgFirstJobId = scraperJob.id;
                console.log(`supervisorJob added scraper job ${orgFirstJobId}`);

                let jobResult:
                    | string
                    | ScraperCrossRequestData = await scraperJob.finished();
                console.log(`supervisorJob: job ${orgFirstJobId} finished`);

                if (
                    typeof jobResult !== 'string' &&
                    !ScraperCrossRequest.isScraperCrossRequestData(jobResult)
                ) {
                    throw new ServerError(
                        `supervisorJob: job ${
                            scraperJob.id
                        } returned illegal result data: ${JSON.stringify(
                            jobResult
                        )}`
                    );
                }

                // process renewal jobs if necessary
                while (
                    ScraperCrossRequest.isScraperCrossRequestData(jobResult)
                ) {
                    console.log(
                        `supervisorJob: job ${scraperJob.id} requested renewal job, dispatching renewal job`
                    );
                    const renewalJob = await gdOrgReviewScraperJobQueue.add(
                        jobResult
                    );

                    // wait for all renewal job done
                    console.log(
                        `supervisorJob: job ${orgFirstJobId}: renewal job ${renewalJob.id} started.`
                    );
                    jobResult = await renewalJob.finished();
                    if (
                        typeof jobResult !== 'string' &&
                        !ScraperCrossRequest.isScraperCrossRequestData(
                            jobResult
                        )
                    ) {
                        throw new ServerError(
                            `supervisorJob: job ${
                                renewalJob.id
                            } returned illegal result data: ${JSON.stringify(
                                jobResult
                            )}`
                        );
                    }

                    console.log(
                        `supervisorJob: job ${orgFirstJobId}: renewal job ${renewalJob.id} finished`
                    );
                }

                console.log('supervisorJob: proceeding to next org');
                supervisorJob.progress(
                    toPercentageValue((processed + 1) / orgInfoList.length)
                );
            }

            console.log(
                'supervisorJob finish dispatching & waiting all jobs done'
            );

            return Promise.resolve('supervisorJob complete successfully');
        })
        .catch(async error => {
            console.log(
                'supervisorJob interrupted due to error; remaining orgList not yet finished (including failed one):',
                orgInfoList.slice(processed, orgInfoList.length)
            );
            await gdOrgReviewScraperJobQueue.empty();
            return Promise.reject(error);
        });
};
