import Bull = require('bull');
import { gdOrgReviewScraperJobQueue } from '../scraperJob/queue';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

const getOrgListFromS3 = () => {
    // TODO: implement fetching S3 objects
    return ['healthcrowd'];
};

module.exports = function (job: Bull.Job<any>, done: Bull.DoneCallback) {
    const data = job.data;
    const result = {
        data: 'nice'
    };

    // TODO: get org list from S3

    console.log('cronjob did some work at', new Date());

    // TODO: for loop: add job for each org
    const gdOrgReviewScraperJob = gdOrgReviewScraperJobQueue.add(
        getOrgListFromS3()
    );

    done(null, result);
    // return Promise.resolve(result);
};
