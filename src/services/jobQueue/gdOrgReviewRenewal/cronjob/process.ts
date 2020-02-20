import Bull = require('bull');
import { gdOrgReviewScraperJobQueue } from '../scraperJob/queue';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

const getOrgListFromS3 = () => {
    // TODO: implement fetching S3 objects
    return ['healthcrowd'];
};

/**
 * Main goal for this process is to schedule jobs on the right time.
 * This process will just keep dispatching jobs for each orgs,
 * will not do any check or follow up after spawning these jobs.
 *
 * To view all the queued jobs, you can use the UI.
 *
 */
module.exports = async function (job: Bull.Job<any>, done: Bull.DoneCallback) {
    console.log('cronjob started at', new Date());

    if (
        (await gdOrgReviewScraperJobQueue.getWaitingCount()) ||
        (await gdOrgReviewScraperJobQueue.getDelayedCount()) ||
        (await gdOrgReviewScraperJobQueue.getPausedCount()) ||
        (await gdOrgReviewScraperJobQueue.getActiveCount())
    ) {
        // there's pending job still in the scraper job queue,
        // let previous pending jobs finish first.
        // ignore this cronjob (schedule job upon next cronjob)
        console.warn(
            'Previous pending scraper jobs exist, will ignore this cronjob'
        );
        return;
    }

    console.log('cronjob will dispatch scraper jobs');

    const orgList = getOrgListFromS3();
    const jobIds = (
        await Promise.all(
            orgList.map(orgInfo => {
                return gdOrgReviewScraperJobQueue.add({ orgInfo });
            })
        )
    ).map(job => job.id);

    console.log('cronjob finish dispatching jobs');

    const result = {
        message: 'dispatch success',
        orgList,
        gdOrgReviewScraperJobIds: jobIds
    };

    return done(null, result);
    // return Promise.resolve(result);
};
