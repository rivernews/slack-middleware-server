import Bull from 'bull';
import path from 'path';
import fs from 'fs';
import { JobQueueName, getProssesorName } from './jobQueueName';
import { redisManager, JobQueueSharedRedisClientsSingleton } from '../redis';
import { asyncSendSlackMessage } from '../slack';
import { RuntimeEnvironment } from '../../utilities/runtime';
import { ServerError } from '../../utilities/serverExceptions';

export const SCRAPER_JOB_POOL_MAX_CONCURRENCY = process.env
    .SCRAPER_JOB_POOL_MAX_CONCURRENCY
    ? parseInt(process.env.SCRAPER_JOB_POOL_MAX_CONCURRENCY)
    : 4;
export const SUPERVISOR_JOB_CONCURRENCY = process.env.SUPERVISOR_JOB_CONCURRENCY
    ? parseInt(process.env.SUPERVISOR_JOB_CONCURRENCY)
    : 4;

interface JobQueueManagerProps {
    __processDirname: string;
    relativePathWithoutExtension: string;

    queueName: JobQueueName;
    jobConcurrency: number;
    queueAbbreviation?: string;

    defaultJobOptions?: Bull.JobOptions;
}

export class JobQueueManager<JobRequestData> {
    // private static CONCURRENCY_PER_SANDBOX_PROCESSOR = 1;
    private jobConcurrency: number;

    public queue?: Bull.Queue<JobRequestData>;
    private _processFileName: string;

    private jobWideLogPrefix: string;
    private queueWideLogPrefix: string;
    private queueName: JobQueueName;
    private sandboxProcessName: string = '';
    private defaultJobOptions?: Bull.JobOptions;
    private static jobQueueSharedRedisClientsSingleton: JobQueueSharedRedisClientsSingleton;

    public constructor (props: JobQueueManagerProps) {
        const processTypescriptPath = path.join(
            props.__processDirname,
            props.relativePathWithoutExtension + '.ts'
        );
        const processJavascriptPath = path.join(
            props.__processDirname,
            props.relativePathWithoutExtension + '.js'
        );

        this._processFileName = fs.existsSync(processTypescriptPath)
            ? processTypescriptPath
            : processJavascriptPath;

        this.queueName = props.queueName;
        this.jobConcurrency = props.jobConcurrency;
        this.defaultJobOptions = props.defaultJobOptions;
        this.jobWideLogPrefix = props.queueAbbreviation || props.queueName;
        this.queueWideLogPrefix = `${this.jobWideLogPrefix}Queue`;
    }

    public initialize (
        processName: string,
        registerProcessorAndEvents: boolean
    ) {
        this.sandboxProcessName = processName;

        if (this.queue) {
            console.log(
                `In ${this.sandboxProcessName} process`,
                'already initialized queue',
                this.queueName
            );
            return;
        }

        // assign shared redis client for this JobQueueManager
        if (!JobQueueManager.jobQueueSharedRedisClientsSingleton) {
            JobQueueManager.jobQueueSharedRedisClientsSingleton =
                JobQueueSharedRedisClientsSingleton.singleton;
        }

        // initialize shared redis client if needed
        if (
            !(
                JobQueueManager.jobQueueSharedRedisClientsSingleton
                    .genericClient &&
                JobQueueManager.jobQueueSharedRedisClientsSingleton
                    .subscriberClient
            )
        ) {
            JobQueueManager.jobQueueSharedRedisClientsSingleton.intialize(
                `${this.sandboxProcessName}`
            );
        }

        this.queue = new Bull<JobRequestData>(this.queueName, {
            redis: redisManager.config,
            defaultJobOptions: {
                // prevent job from retrying
                attempts: 1,

                ...this.defaultJobOptions
            },

            settings: {
                // prevent job from retrying if get stalled
                // https://github.com/OptimalBits/bull/issues/1591#issuecomment-566745597
                maxStalledCount: 0,

                // avoid job being moved to stalled, usually happens for CPU-intensive jobs
                lockDuration: 2 * 60 * 1000
            },

            // reuse redis connection
            // https://github.com/OptimalBits/bull/blob/master/PATTERNS.md#reusing-redis-connections
            createClient: type => {
                if (
                    !(
                        JobQueueManager.jobQueueSharedRedisClientsSingleton
                            .genericClient &&
                        JobQueueManager.jobQueueSharedRedisClientsSingleton
                            .subscriberClient
                    )
                ) {
                    throw new ServerError(
                        `In ${this.sandboxProcessName} process, shared genericClient & subscriberClient not yet initialized`
                    );
                }

                switch (type) {
                    case 'client':
                        return JobQueueManager
                            .jobQueueSharedRedisClientsSingleton.genericClient;
                    case 'subscriber':
                        return JobQueueManager
                            .jobQueueSharedRedisClientsSingleton
                            .subscriberClient;
                    default:
                        return JobQueueManager.jobQueueSharedRedisClientsSingleton.newJobQueueIORedisClient(
                            `Bull:${this.queueWideLogPrefix}:${type}Type`
                        );
                }
            }
        });
        console.log(
            `In ${this.sandboxProcessName} process, initialized job queue for ${this.queueName}`
        );

        if (!registerProcessorAndEvents) {
            return;
        }

        // concurrency `n`: one sandbox process for each job - sandbox process is child process, piles till `n` child process
        // note that do not run .process() i.e. register processor for another queue in child process, otherwise the actual
        // concurrency will pile up
        //
        // for "worker" - you need a brand new process, not child process. That means another `node index.js` process.
        this.queue.process(
            getProssesorName(this.queueName),
            this.jobConcurrency,
            this._processFileName
        );

        // Events API
        // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#events
        this.queue.on('error', error => {
            // An error occured.
            console.error(
                `In ${this.sandboxProcessName} process, ${this.queueWideLogPrefix} error`,
                error
            );
        });

        this.queue.on('waiting', jobId => {
            // A Job is waiting to be processed as soon as a worker is idling.
            console.log(
                `In ${this.sandboxProcessName} process, ${this.jobWideLogPrefix} ${jobId} waiting`
            );
        });

        this.queue.on('active', (job, jobPromise) => {
            // A job has started. You can use `jobPromise.cancel()`` to abort it.
            console.log(
                `In ${this.sandboxProcessName} process, ${this.jobWideLogPrefix} ${job.id} active`
            );
        });

        this.queue.on('stalled', job => {
            // A job has been marked as stalled. This is useful for debugging job
            // workers that crash or pause the event loop.
            console.log(
                `In ${this.sandboxProcessName} process, ${this.jobWideLogPrefix} ${job.id} stalled`
            );
        });

        this.queue.on('progress', (job, progress) => {
            // A job's progress was updated!
            console.log(
                `In ${this.sandboxProcessName} process, ${this.jobWideLogPrefix} ${job.id}  progress`,
                progress
            );
        });

        this.queue.on('completed', (job, result) => {
            // A job successfully completed with a `result`.
            console.log(
                `In ${this.sandboxProcessName} process, ${this.jobWideLogPrefix} ${job.id}  completed, result:`,
                result
            );
        });

        this.queue.on('failed', (job, err) => {
            // A job failed with reason `err`!
            console.error(
                `In ${this.sandboxProcessName} process, ${this.jobWideLogPrefix} ${job.id} failed`,
                err
            );
        });

        this.queue.on('paused', () => {
            // The queue has been paused.
            console.log(
                `In ${this.sandboxProcessName} process, ${this.queueWideLogPrefix} paused`
            );
        });

        this.queue.on('resumed', () => {
            // The queue has been resumed.
            console.log(
                `In ${this.sandboxProcessName} process, ${this.queueWideLogPrefix} resumed`
            );
        });

        this.queue.on('cleaned', (jobs, type) => {
            // Old jobs have been cleaned from the queue. `jobs` is an array of cleaned
            // jobs, and `type` is the type of jobs cleaned.
            console.log(
                `In ${this.sandboxProcessName} process, ${this.jobWideLogPrefix} cleaned:`,
                jobs.map(job => job.id)
            );
        });

        this.queue.on('drained', () => {
            // Emitted every time the queue has processed all the waiting jobs (even if there can be some delayed jobs not yet processed)
            console.log(
                `In ${this.sandboxProcessName} process, ${this.queueWideLogPrefix} drained`
            );
        });

        this.queue.on('removed', job => {
            // A job successfully removed.
            console.log(
                `In ${this.sandboxProcessName} process, ${this.jobWideLogPrefix} ${job.id} removed`
            );
        });
    }

    public asyncAdd (jobData: JobRequestData) {
        if (!this.queue) {
            return Promise.reject(
                new Error(
                    `You want to dispatch job but queue not yet initialized, did you call ${this.queueName}Manager.initialize() first?`
                )
            );
        }

        return this.queue.add(getProssesorName(this.queueName), jobData);
    }

    /**
     * Throws a promise rejection if concurrency limit reached, or a resolve if not.
     *
     * @param concurrency The concurrency limit for either the queue you pass in by `concurrencyCheckQueue`, or if you don't, this manager's own queue
     * @param concurrencyCheckQueue Queue you want to explicitly check concurrency for
     * @param currentActiveJobToBeCheck For better log information. Note that job can be from any queue, not just queue of this manager. If you are calling this `checkConcurrency` outside of process function (e.g. before dispatching a job), you may skip this argument.
     * @param currentActiveJobQueueName When specified `currentActiveJobToBeCheck`, this is also required. This arg is for better log information, purpose same as `currentActiveJobToBeCheck`.
     * @param countCurrentActiveJobIntoConcurrency As it's called literally. Useful for case when you are calling this function `checkConcurrency` in an active job (inside a process function), take the active job into consideration when determiing concurrency limit (e.g., the job is already occupy a concurrency in the queue, which decreases the remaining vacancy)
     */
    public checkConcurrency (
        concurrency: number,
        concurrencyCheckQueue?: Bull.Queue,
        currentActiveJobToBeCheck?: Bull.Job<JobRequestData>,
        currentActiveJobQueueName?: string,
        countCurrentActiveJobIntoConcurrency: boolean = false
    ) {
        if (currentActiveJobToBeCheck && !currentActiveJobQueueName) {
            throw new ServerError(
                `You specified currentActiveJobToBeCheck but did not provide currentActiveJobQueueName. Please also pass in the queue name`
            );
        }

        const queueToBeCheck = concurrencyCheckQueue || this.queue;

        if (!queueToBeCheck) {
            throw new ServerError(
                `Failed to check concurrency because queueToBeCheck is null/undefined. If you intend to check self queue, did you run initialize() first?`
            );
        }

        return Promise.all([
            queueToBeCheck.getWaitingCount(),
            queueToBeCheck.getDelayedCount(),
            queueToBeCheck.getPausedCount(),
            queueToBeCheck.getActiveCount()
        ]).then(([waiting, delayed, paused, active]) => {
            const jobsPresentCount = waiting + delayed + paused + active;
            if (
                // if want to count current job in, means current job already active & is included in `jobsPresentCount`
                // in this case, we are whether 'acknowledging' this job conforms to concurrency limit or not
                (countCurrentActiveJobIntoConcurrency &&
                    jobsPresentCount > concurrency) ||
                // otherwise, means job not created yet, so if jobsPresentCount == concurrency
                // there's no space to add any new job, so we should reject
                (!countCurrentActiveJobIntoConcurrency &&
                    jobsPresentCount >= concurrency)
            ) {
                const rejectMessage =
                    `${
                        currentActiveJobToBeCheck && currentActiveJobQueueName
                            ? `${currentActiveJobQueueName} ${currentActiveJobToBeCheck.id}`
                            : queueToBeCheck.name
                    } encountered concurrency limit ${concurrency}, queue ${
                        queueToBeCheck.name
                    } already has ${jobsPresentCount} jobs running. ` +
                    (currentActiveJobToBeCheck
                        ? `Rejecting this job \`\`\`${JSON.stringify(
                              currentActiveJobToBeCheck
                          )}\`\`\``
                        : '');

                if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
                    return Promise.reject(rejectMessage);
                }

                return asyncSendSlackMessage(rejectMessage).then(() =>
                    Promise.reject(rejectMessage)
                );
            } else {
                return jobsPresentCount;
            }
        });
    }

    public async asyncCleanUp () {
        const logPrefix = `In ${this.sandboxProcessName} process, ${this.queueWideLogPrefix}`;

        // cleaning up Bull Queue
        if (this.queue) {
            console.debug(`${logPrefix}: start cleaning up connection...`);
            await this.queue.close();
            console.debug(`${logPrefix}: connection cleaned`);
            this.queue = undefined;
            return;
        }

        console.debug(`${logPrefix}: no queue to clean up, skipping`);

        // cleaning up additional redis client resources (clients not reused but created by Bull.Queue.createClient())
        JobQueueManager.jobQueueSharedRedisClientsSingleton.resetAllClientResources(
            logPrefix
        );
    }
}
