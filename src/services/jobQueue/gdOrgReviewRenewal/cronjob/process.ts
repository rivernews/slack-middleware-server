import Bull = require('bull');
import { gdOrgReviewScraperJobQueue } from '../scraperJob/queue';
import { s3ArchiveManager } from '../../../s3';
import { ServerError } from '../../../../utilities/serverExceptions';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

const getOrgListFromS3 = async () => {
    return s3ArchiveManager.asyncGetOverviewPageUrls();

    // TODO: implement fetching S3 objects
    // return [
    //     'https://www.glassdoor.com/Overview/Working-at-Palo-Alto-Networks-EI_IE115142.11,29.htm'
    // ];

    // return [
    //     'https://www.glassdoor.com/Overview/Working-at-Pinterest-EI_IE503467.11,20.htm'
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
module.exports = function (job: Bull.Job<any>) {
    console.log('cronjob started processing');

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

            return Promise.resolve();
        })
        .then(async () => {
            // get orgList from s3
            let orgInfoList: string[] | null = null;
            try {
                orgInfoList = await getOrgListFromS3();
            } catch (error) {
                return Promise.reject(error);
            }
            console.debug('got orgList from s3', orgInfoList);

            // dispatch job
            if (!orgInfoList || !orgInfoList.length) {
                console.log('org list empty, will do nothing');
                return Promise.resolve('empty orgList');
            }
            console.log('cronjob will dispatch scraper jobs');
            let jobIds: string[] = [];
            for (const orgInfo of orgInfoList) {
                const job = await gdOrgReviewScraperJobQueue.add({ orgInfo });
                console.log(`cronjob added scraper job ${job.id}`);
                jobIds.push(job.id.toString());

                // const jobResult =  await job.finished();
                // console.log(`job ${job.id} result is`, jobResult);
                // job.progress((jobIds.length / orgInfoList.length) * 100.0);
            }

            console.log('cronjob finish dispatching jobs', jobIds);
            console.log('total of jobs finished', jobIds.length);

            const result = {
                message: 'dispatch success',
                orgList: orgInfoList,
                gdOrgReviewScraperJobIds: jobIds
            };

            return Promise.resolve(result);
        })
        .catch(error => {
            return Promise.reject(error);
        });
};
