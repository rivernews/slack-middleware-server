import Bull = require('bull');
import path from 'path';
import fs from 'fs';
import { redisConnectionConfig } from '../../../redis';
import { JobQueueName } from '../../jobQueueName';

export interface GdOrgReviewRenewalCronjobData {}

const processTypescriptPath = path.join(__dirname, './process.ts');
const processJavascriptPath = path.join(__dirname, './process.js');
const processFileName = fs.existsSync(processTypescriptPath)
    ? processTypescriptPath
    : processJavascriptPath;

// Bull website quick guide
// https://optimalbits.github.io/bull/

// Quick guide creating queue
// https://github.com/OptimalBits/bull#quick-guide

export const gdOrgReviewRenewalCronjobQueue = new Bull<
    GdOrgReviewRenewalCronjobData
>(JobQueueName.GD_ORG_REVIEW_RENEWAL_CRONJOB, {
    redis: redisConnectionConfig,
    defaultJobOptions: {
        repeat: {
            // cron expression descriptor
            // https://cronexpressiondescriptor.azurewebsites.net/
            cron: '* * * * *'
        }
    }
});

gdOrgReviewRenewalCronjobQueue.process(processFileName);

// Events API
// https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#events
gdOrgReviewRenewalCronjobQueue.on('error', function (error) {
    // An error occured.
    console.error('cronjob error');
});

gdOrgReviewRenewalCronjobQueue.on('waiting', function (jobId) {
    // A Job is waiting to be processed as soon as a worker is idling.
    console.log('cronjob waiting');
});

gdOrgReviewRenewalCronjobQueue.on('active', function (job, jobPromise) {
    // A job has started. You can use `jobPromise.cancel()`` to abort it.
    console.log('cronjob active');
});

gdOrgReviewRenewalCronjobQueue.on('stalled', function (job) {
    // A job has been marked as stalled. This is useful for debugging job
    // workers that crash or pause the event loop.
    console.log('cronjob stalled');
});

gdOrgReviewRenewalCronjobQueue.on('progress', function (job, progress) {
    // A job's progress was updated!
    console.log('cronjob progress');
});

gdOrgReviewRenewalCronjobQueue.on('completed', function (job, result) {
    // A job successfully completed with a `result`.
    console.log('cronjob completed');
});

gdOrgReviewRenewalCronjobQueue.on('failed', function (job, err) {
    // A job failed with reason `err`!
    console.error('cronjob failed', err);
});

gdOrgReviewRenewalCronjobQueue.on('paused', function () {
    // The queue has been paused.
    console.log('cronjob paused');
});

gdOrgReviewRenewalCronjobQueue.on('resumed', function (job: Bull.Job<any>) {
    // The queue has been resumed.
    console.log('cronjob resumed');
});

gdOrgReviewRenewalCronjobQueue.on('cleaned', function (jobs, type) {
    // Old jobs have been cleaned from the queue. `jobs` is an array of cleaned
    // jobs, and `type` is the type of jobs cleaned.
    console.log('cronjob cleaned');
});

gdOrgReviewRenewalCronjobQueue.on('drained', function () {
    // Emitted every time the queue has processed all the waiting jobs (even if there can be some delayed jobs not yet processed)
    console.log('cronjob drained');
});

gdOrgReviewRenewalCronjobQueue.on('removed', function (job) {
    // A job successfully removed.
    console.log('cronjob removed');
});
