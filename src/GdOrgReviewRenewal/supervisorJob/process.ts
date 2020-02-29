import Bull = require('bull');
import { gdOrgReviewScraperJobQueue } from '../scraperJob/queue';
import {
    ScraperCrossRequest,
    ScraperCrossRequestData,
    SupervisorJobRequestData
} from '../../services/jobQueue/types';
import { s3ArchiveManager } from '../../services/s3';
import { toPercentageValue } from '../../utilities/runtime';

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

    const orgInfoList = Array.isArray(supervisorJob.data)
        ? supervisorJob.data
        : [supervisorJob.data];
    let processed = 0;

    return Promise.all([
        gdOrgReviewScraperJobQueue.getWaitingCount(),
        gdOrgReviewScraperJobQueue.getDelayedCount(),
        gdOrgReviewScraperJobQueue.getPausedCount(),
        gdOrgReviewScraperJobQueue.getActiveCount()
    ])
        .then(([waiting, delayed, paused, active]) => {
            if (waiting || delayed || paused || active) {
                // there's pending job still in the scraper job queue,
                // let previous pending jobs finish first.
                // ignore this cronjob (schedule job upon next cronjob)
                console.warn(
                    'Previous pending scraper jobs exist, will ignore this cronjob'
                );
                return Promise.reject('cronjob skip');
            }

            supervisorJob.progress(supervisorJob.progress() + 1);

            return Promise.resolve();
        })
        .then(async () => {
            // get orgList from s3
            // try {
            //     orgInfoList = await getOrgListFromS3();
            //     cronjob.progress(cronjob.progress() + 1);
            // } catch (error) {
            //     return Promise.reject(error);
            // }

            // dispatch job
            if (!orgInfoList.length) {
                console.log('org list empty, will do nothing');
                return Promise.resolve('empty orgList');
            }
            console.log('cronjob will dispatch scraper jobs');
            for (processed = 0; processed < orgInfoList.length; processed++) {
                const orgInfo = orgInfoList[processed];
                let scraperJob = await gdOrgReviewScraperJobQueue.add({
                    orgInfo
                });
                const orgFirstJobId = scraperJob.id;
                console.log(`cronjob added scraper job ${orgFirstJobId}`);

                let jobResult:
                    | string
                    | ScraperCrossRequestData = await scraperJob.finished();
                console.log(`cronjob: job ${orgFirstJobId} finished`);

                // process renewal jobs if necessary
                while (
                    ScraperCrossRequest.isScraperCrossRequestData(jobResult)
                ) {
                    console.log(
                        `cronjob: job ${scraperJob.id} requested renewal job, dispatching renewal job`
                    );
                    const renewalJob = await gdOrgReviewScraperJobQueue.add(
                        jobResult
                    );

                    // wait for all renewal job done
                    console.log(
                        `cronjob: job ${orgFirstJobId}: renewal job ${renewalJob.id} started.`
                    );
                    jobResult = await renewalJob.finished();
                    console.log(
                        `cronjob: job ${orgFirstJobId}: renewal job ${renewalJob.id} finished`
                    );
                }

                console.log('cronjob: proceeding to next org');
                supervisorJob.progress(
                    toPercentageValue((processed + 1) / orgInfoList.length)
                );
            }

            console.log('cronjob finish dispatching & waiting all jobs done');

            return Promise.resolve('cronjob complete successfully');
        })
        .catch(async error => {
            console.log(
                'cronjob interrupted due to error; remaining orgList not yet finished (including failed one):',
                orgInfoList.slice(processed, orgInfoList.length)
            );
            await gdOrgReviewScraperJobQueue.empty();
            return Promise.reject(error);
        });
};
