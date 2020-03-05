import Bull = require('bull');
import path from 'path';
import fs from 'fs';
import { JobQueueName } from './jobQueueName';
import { redisManager, jobQueueSharedRedisClients } from '../redis';

interface JobQueueManagerProps {
    __processDirname: string;
    relativePathWithoutExtension: string;

    queueName: JobQueueName;
    queueAbbreviation?: string;

    defaultJobOptions?: Bull.JobOptions;
}

export class JobQueueManager<JobRequestData> {
    private static CONCURRENCY = 1;

    public queue: Bull.Queue<JobRequestData>;

    public constructor (props: JobQueueManagerProps) {
        const processTypescriptPath = path.join(
            props.__processDirname,
            props.relativePathWithoutExtension + '.ts'
        );
        const processJavascriptPath = path.join(
            props.__processDirname,
            props.relativePathWithoutExtension + '.js'
        );

        const processFileName = fs.existsSync(processTypescriptPath)
            ? processTypescriptPath
            : processJavascriptPath;

        this.queue = new Bull<JobRequestData>(props.queueName, {
            redis: redisManager.config,
            defaultJobOptions: props.defaultJobOptions,

            // reuse redis connection
            // https://github.com/OptimalBits/bull/blob/master/PATTERNS.md#reusing-redis-connections
            createClient: type => {
                switch (type) {
                    case 'client':
                        return jobQueueSharedRedisClients.genericClient;
                    case 'subscriber':
                        return jobQueueSharedRedisClients.subscriberClient;
                    default:
                        return redisManager.newIORedisClient();
                }
            }
        });

        this.queue.process(JobQueueManager.CONCURRENCY, processFileName);

        const logPrefix = props.queueAbbreviation || props.queueName;

        // Events API
        // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#events
        this.queue.on('error', function (error) {
            // An error occured.
            console.error(`${logPrefix} error`, error);
        });

        this.queue.on('waiting', function (jobId) {
            // A Job is waiting to be processed as soon as a worker is idling.
            console.log(`${logPrefix} ${jobId} waiting`);
        });

        this.queue.on('active', function (job, jobPromise) {
            // A job has started. You can use `jobPromise.cancel()`` to abort it.
            console.log(`${logPrefix} ${job.id} active`);
        });

        this.queue.on('stalled', function (job) {
            // A job has been marked as stalled. This is useful for debugging job
            // workers that crash or pause the event loop.
            console.log(`${logPrefix} ${job.id} stalled`);
        });

        this.queue.on('progress', function (job, progress) {
            // A job's progress was updated!
            console.log(`${logPrefix} ${job.id}  progress`, progress);
        });

        this.queue.on('completed', function (job, result) {
            // A job successfully completed with a `result`.
            console.log(`${logPrefix} ${job.id}  completed, result:`, result);
        });

        this.queue.on('failed', function (job, err) {
            // A job failed with reason `err`!
            console.error(`${logPrefix} ${job.id}  failed`, err);
        });

        this.queue.on('paused', function () {
            // The queue has been paused.
            console.log(`${logPrefix} paused`);
        });

        this.queue.on('resumed', function (job: Bull.Job<any>) {
            // The queue has been resumed.
            console.log(`${logPrefix} ${job.id} resumed`);
        });

        this.queue.on('cleaned', function (jobs, type) {
            // Old jobs have been cleaned from the queue. `jobs` is an array of cleaned
            // jobs, and `type` is the type of jobs cleaned.
            console.log(
                `${logPrefix} cleaned:`,
                jobs.map(job => job.id)
            );
        });

        this.queue.on('drained', function () {
            // Emitted every time the queue has processed all the waiting jobs (even if there can be some delayed jobs not yet processed)
            console.log(`${logPrefix} drained`);
        });

        this.queue.on('removed', function (job) {
            // A job successfully removed.
            console.log(`${logPrefix} ${job.id} removed`);
        });
    }
}
