import Bull = require('bull');
import { gdOrgReviewRenewalCronjobQueue } from '..';
import path from 'path';
import fs from 'fs';

const processTypescriptPath = path.join(
    __dirname,
    './gdOrgReviewRenewalJob.ts'
);
const processJavascriptPath = path.join(
    __dirname,
    './gdOrgReviewRenewalJob.js'
);
const processFileName = fs.existsSync(processTypescriptPath)
    ? processTypescriptPath
    : processJavascriptPath;

gdOrgReviewRenewalCronjobQueue.process(processFileName);

// Events API
// https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#events
gdOrgReviewRenewalCronjobQueue.on('error', function (error) {
    // An error occured.
    console.error('error');
});

gdOrgReviewRenewalCronjobQueue.on('waiting', function (jobId) {
    // A Job is waiting to be processed as soon as a worker is idling.
    console.log('waiting');
});

gdOrgReviewRenewalCronjobQueue.on('active', function (job, jobPromise) {
    // A job has started. You can use `jobPromise.cancel()`` to abort it.
    console.log('active');
});

gdOrgReviewRenewalCronjobQueue.on('stalled', function (job) {
    // A job has been marked as stalled. This is useful for debugging job
    // workers that crash or pause the event loop.
    console.log('stalled');
});

gdOrgReviewRenewalCronjobQueue.on('progress', function (job, progress) {
    // A job's progress was updated!
    console.log('progress');
});

gdOrgReviewRenewalCronjobQueue.on('completed', function (job, result) {
    // A job successfully completed with a `result`.
    console.log('completed');
});

gdOrgReviewRenewalCronjobQueue.on('failed', function (job, err) {
    // A job failed with reason `err`!
    console.error('failed', err);
});

gdOrgReviewRenewalCronjobQueue.on('paused', function () {
    // The queue has been paused.
    console.log('paused');
});

gdOrgReviewRenewalCronjobQueue.on('resumed', function (job: Bull.Job<any>) {
    // The queue has been resumed.
    console.log('resumed');
});

gdOrgReviewRenewalCronjobQueue.on('cleaned', function (jobs, type) {
    // Old jobs have been cleaned from the queue. `jobs` is an array of cleaned
    // jobs, and `type` is the type of jobs cleaned.
    console.log('cleaned');
});

gdOrgReviewRenewalCronjobQueue.on('drained', function () {
    // Emitted every time the queue has processed all the waiting jobs (even if there can be some delayed jobs not yet processed)
    console.log('drained');
});

gdOrgReviewRenewalCronjobQueue.on('removed', function (job) {
    // A job successfully removed.
    console.log('removed');
});

const getOrgListFromS3 = () => {
    return ['healthcrowd'];
};

export const gdOrgReviewRenewalCronjob = gdOrgReviewRenewalCronjobQueue.add(
    getOrgListFromS3()
);
