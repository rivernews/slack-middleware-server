import Bull = require('bull');
import path from 'path';
import fs from 'fs';
import { JobQueueName } from './jobQueueName';
import { redisManager, jobQueueSharedRedisClients } from '../redis';
import { asyncSendSlackMessage } from '../slack';
import { RuntimeEnvironment } from '../../utilities/runtime';

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

    private logPrefix: string;

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

        this.logPrefix = props.queueAbbreviation || props.queueName;

        // Events API
        // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#events
        this.queue.on('error', error => {
            // An error occured.
            console.error(`${this.logPrefix} error`, error);
        });

        this.queue.on('waiting', jobId => {
            // A Job is waiting to be processed as soon as a worker is idling.
            console.log(`${this.logPrefix} ${jobId} waiting`);
        });

        this.queue.on('active', (job, jobPromise) => {
            // A job has started. You can use `jobPromise.cancel()`` to abort it.
            console.log(`${this.logPrefix} ${job.id} active`);
        });

        this.queue.on('stalled', job => {
            // A job has been marked as stalled. This is useful for debugging job
            // workers that crash or pause the event loop.
            console.log(`${this.logPrefix} ${job.id} stalled`);
        });

        this.queue.on('progress', (job, progress) => {
            // A job's progress was updated!
            console.log(`${this.logPrefix} ${job.id}  progress`, progress);
        });

        this.queue.on('completed', (job, result) => {
            // A job successfully completed with a `result`.
            console.log(
                `${this.logPrefix} ${job.id}  completed, result:`,
                result
            );
        });

        this.queue.on('failed', (job, err) => {
            // A job failed with reason `err`!
            console.error(`${this.logPrefix} ${job.id}  failed`, err);
        });

        this.queue.on('paused', () => {
            // The queue has been paused.
            console.log(`${this.logPrefix} paused`);
        });

        this.queue.on('resumed', (job: Bull.Job<any>) => {
            // The queue has been resumed.
            console.log(`${this.logPrefix} ${job.id} resumed`);
        });

        this.queue.on('cleaned', (jobs, type) => {
            // Old jobs have been cleaned from the queue. `jobs` is an array of cleaned
            // jobs, and `type` is the type of jobs cleaned.
            console.log(
                `${this.logPrefix} cleaned:`,
                jobs.map(job => job.id)
            );
        });

        this.queue.on('drained', () => {
            // Emitted every time the queue has processed all the waiting jobs (even if there can be some delayed jobs not yet processed)
            console.log(`${this.logPrefix} drained`);
        });

        this.queue.on('removed', job => {
            // A job successfully removed.
            console.log(`${this.logPrefix} ${job.id} removed`);
        });
    }

    public checkConcurrency (
        concurrency: number,
        concurrencyCheckQueue?: Bull.Queue,
        job?: Bull.Job
    ) {
        const queueToBeCheck = concurrencyCheckQueue || this.queue;

        return Promise.all([
            queueToBeCheck.getWaitingCount(),
            queueToBeCheck.getDelayedCount(),
            queueToBeCheck.getPausedCount(),
            queueToBeCheck.getActiveCount()
        ]).then(([waiting, delayed, paused, active]) => {
            const jobsPresentCount = waiting + delayed + paused + active;
            if (
                // if job passed in, means current job already active & is included in `jobsPresentCount`
                // in this case, we are whether 'acknowledging' this job is conformed to concurrency limit or not
                (job && jobsPresentCount > concurrency) ||
                // if job not passed in, means job not created yet, so if jobsPresentCount == concurrency
                // there's no space to add any new job, so we should reject
                (!job && jobsPresentCount >= concurrency)
            ) {
                const rejectMessage =
                    `${this.logPrefix} reach concurrency limit ${concurrency}, queue ${queueToBeCheck.name} already has ${jobsPresentCount} jobs running. ` +
                    (job
                        ? `Rejecting this job \`\`\`${JSON.stringify(
                              job
                          )}\`\`\``
                        : '');

                if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
                    return Promise.reject(rejectMessage);
                }

                return asyncSendSlackMessage(rejectMessage).then(() =>
                    Promise.reject(rejectMessage)
                );
            } else {
                return Promise.resolve(jobsPresentCount);
            }
        });
    }
}
