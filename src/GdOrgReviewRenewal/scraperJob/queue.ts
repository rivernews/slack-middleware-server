import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { ScraperJobRequestData } from '../../services/jobQueue/types';
import { JobQueueManager } from '../../services/jobQueue/JobQueueManager';

export const gdOrgReviewScraperJobQueueManager = new JobQueueManager<
    ScraperJobRequestData
>({
    __processDirname: __dirname,
    relativePathWithoutExtension: './process',
    queueName: JobQueueName.GD_ORG_REVIEW_SCRAPER_JOB,
    defaultJobOptions: {
        // TODO: enable repeat opt when in prod
        // repeat: {
        //     // cron expression descriptor
        //     // https://cronexpressiondescriptor.azurewebsites.net/
        //     // cron: '* * * * *',
        //     // other options
        //     // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueadd
        //     every: 60 * (60 * 1000)
        // }
    }
});

// const processTypescriptPath = path.join(__dirname, './process.ts');
// const processJavascriptPath = path.join(__dirname, './process.js');
// const processFileName = fs.existsSync(processTypescriptPath)
//     ? processTypescriptPath
//     : processJavascriptPath;

// // Bull website quick guide
// // https://optimalbits.github.io/bull/

// // Quick guide creating queue
// // https://github.com/OptimalBits/bull#quick-guide
// export const gdOrgReviewScraperJobQueue = new Bull<ScraperJobRequestData>(
//     JobQueueName.GD_ORG_REVIEW_SCRAPER_JOB,
//     {
//         redis: redisManager.config
//     }
// );

// const concurrency = 1;
// gdOrgReviewScraperJobQueue.process(concurrency, processFileName);

// // Events API
// // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#events
// gdOrgReviewScraperJobQueue.on('error', function (error) {
//     // An error occured.
//     console.error('org job error');
// });

// gdOrgReviewScraperJobQueue.on('waiting', function (jobId) {
//     // A Job is waiting to be processed as soon as a worker is idling.
//     console.log(`org job ${jobId} waiting`);
// });

// gdOrgReviewScraperJobQueue.on('active', function (job, jobPromise) {
//     // A job has started. You can use `jobPromise.cancel()`` to abort it.
//     console.log(`org job ${job.id} active`);
// });

// gdOrgReviewScraperJobQueue.on('stalled', function (job) {
//     // A job has been marked as stalled. This is useful for debugging job
//     // workers that crash or pause the event loop.
//     console.log(`org job ${job.id} stalled`);
// });

// gdOrgReviewScraperJobQueue.on('progress', function (job, progress) {
//     // A job's progress was updated!
//     console.log(`org job ${job.id} progress ${progress}`);
// });

// gdOrgReviewScraperJobQueue.on('completed', function (job, result) {
//     // A job successfully completed with a `result`.
//     console.log(`org job ${job.id} completed, result:`, result);
// });

// gdOrgReviewScraperJobQueue.on('failed', function (job, err) {
//     // A job failed with reason `err`!
//     console.error(`org job ${job.id} failed`, err);
// });

// gdOrgReviewScraperJobQueue.on('paused', function () {
//     // The queue has been paused.
//     console.log('org job paused');
// });

// gdOrgReviewScraperJobQueue.on('resumed', function (job: Bull.Job<any>) {
//     // The queue has been resumed.
//     console.log(`job ${job.id} resumed`);
// });

// gdOrgReviewScraperJobQueue.on('cleaned', function (jobs, type) {
//     // Old jobs have been cleaned from the queue. `jobs` is an array of cleaned
//     // jobs, and `type` is the type of jobs cleaned.
//     console.log(`jobs ${jobs.map(job => job.id)} cleaned`);
// });

// gdOrgReviewScraperJobQueue.on('drained', function () {
//     // Emitted every time the queue has processed all the waiting jobs (even if there can be some delayed jobs not yet processed)
//     console.log('drained');
// });

// gdOrgReviewScraperJobQueue.on('removed', function (job) {
//     // A job successfully removed.
//     console.log(`job ${job.id} removed`);
// });
