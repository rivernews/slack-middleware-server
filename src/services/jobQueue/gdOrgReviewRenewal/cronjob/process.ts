import Bull = require('bull');
import { gdOrgReviewScraperJobQueue } from '../scraperJob/queue';
import { ScraperCrossRequest, ScraperCrossRequestData } from '../../types';
import { s3ArchiveManager } from '../../../s3';
import { toPercentageValue } from '../../../../utilities/runtime';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

const getOrgListFromS3 = async () => {
    return s3ArchiveManager.asyncGetOverviewPageUrls();

    // return [
    //     'https://www.glassdoor.com/Overview/Working-at-Palo-Alto-Networks-EI_IE115142.11,29.htm'
    // ];

    // return [
    //     'healthcrowd',
    //     'https://www.glassdoor.com/Overview/Working-at-Pinterest-EI_IE503467.11,20.htm',
    // ];
    // return ['"Palo Alto Network"'];
    // return [];
    // return ['healthcrowd'];
};

/**
 * Main goal for this process is to schedule jobs on the right time.
 * This process will just keep dispatching jobs for each orgs,
 * will not do any check or follow up after spawning these jobs.
 *
 * To view all the queued jobs, you can use the UI.
 *
 */
module.exports = function (cronjob: Bull.Job<any>) {
    console.log('cronjob started processing, with params', cronjob.data);

    let orgInfoList: string[] | null = null;

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

            cronjob.progress(cronjob.progress() + 1);

            return Promise.resolve();
        })
        .then(async () => {
            // get orgList from s3
            try {
                orgInfoList = await getOrgListFromS3();
                cronjob.progress(cronjob.progress() + 1);
            } catch (error) {
                return Promise.reject(error);
            }

            const overallOrgListLength = orgInfoList.length;
            console.debug('got orgList from s3', orgInfoList);

            // dispatch job
            if (!orgInfoList || !orgInfoList.length) {
                console.log('org list empty, will do nothing');
                return Promise.resolve('empty orgList');
            }
            console.log('cronjob will dispatch scraper jobs');
            while (orgInfoList.length) {
                const orgInfo = orgInfoList.pop();
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
                cronjob.progress(
                    toPercentageValue(
                        (overallOrgListLength - orgInfoList.length) /
                            overallOrgListLength
                    )
                );
            }

            console.log('cronjob finish dispatching & waiting all jobs done');

            return Promise.resolve('cronjob complete successfully');
        })
        .catch(async error => {
            if (orgInfoList === null) {
                console.error('cannot retrieve org info list from s3');
            } else {
                console.log(
                    'cronjob interrupted due to error; remaining orgList not yet touched:',
                    orgInfoList
                );
                await gdOrgReviewScraperJobQueue.empty();
            }
            return Promise.reject(error);
        });
};
