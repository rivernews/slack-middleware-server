import Bull from 'bull';
import { redisManager, RedisPubSubChannelName } from '../../services/redis';
import { checkTravisHasVacancy, TravisManager } from '../../services/travis';
import { asyncSendSlackMessage } from '../../services/slack';
import {
    ScraperJobRequestData,
    ScraperCrossRequest,
    ScraperJobMessageTo,
    ScraperJobMessageType,
    ScraperProgressData
} from '../../services/jobQueue/types';
import { ProgressBarManager } from '../../services/jobQueue/ProgressBar';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS } from '../../services/travis';
import { composePubsubMessage } from '../../services/jobQueue/message';
import IORedis from 'ioredis';
import { KubernetesService } from '../../services/kubernetes/kubernetes';
import { RuntimeEnvironment } from '../../utilities/runtime';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

const cleanupRedisSubscriptionConnection = async (
    redisPubsubChannelName: string,
    redisClientSubscription: IORedis.Redis,
    redisClientPublish: IORedis.Redis,
    org: string = 'null',
    jobIdString: string
) => {
    const lockValue = await redisClientPublish.get(
        `lock:${redisPubsubChannelName}`
    );
    if (lockValue) {
        console.debug('lock value', lockValue);
        if (lockValue === jobIdString) {
            await redisClientPublish.del(`lock:${redisPubsubChannelName}`);
            console.debug(`cleared pubsub lock:${redisPubsubChannelName}`);
        } else {
            console.debug(
                `job ${jobIdString}: not owner of lock ${lockValue}, skipping lock clean up`
            );
        }
    } else {
        console.debug('no lock, skipping lock clean up');
    }

    if (await redisClientSubscription.unsubscribe()) {
        console.log(
            `unsubscribed channel ${redisPubsubChannelName} successfully, org:`,
            org
        );
    } else {
        console.error(
            `Failed to unsubscribe pubsub for travis scraper job, org: ${org}, trying to quit client anyway`
        );
    }

    await redisClientSubscription.quit();
    await redisClientPublish.quit();
};

class ScraperJobProcessResourcesCleaner {
    private static _singleton = new ScraperJobProcessResourcesCleaner();

    private pid: number;

    public processName: string = 'master';

    private constructor (
        public lastRedisPubsubChannelName?: string,
        public lastRedisClientSubscription?: IORedis.Redis,
        public lastRedisClientPublish?: IORedis.Redis,
        public lastOrg?: string,
        public lastJobIdString?: string,
        public lastK8JobSemaphoreResourceString?: string,
        public lastTravisJobSemaphoreResourceString?: string,
        public runtimePlatformDescriptor?: string
    ) {
        this.pid = process.pid;
    }

    public static get singleton () {
        return ScraperJobProcessResourcesCleaner._singleton;
    }

    public async asyncCleanup () {
        if (
            this.lastRedisPubsubChannelName &&
            this.lastRedisClientSubscription &&
            this.lastRedisClientPublish &&
            this.lastOrg &&
            this.lastJobIdString
        ) {
            console.debug(
                `In ${this.processName} process pid ${this.pid}, redis cleaner starting...`
            );

            // release semaphores

            if (this.lastK8JobSemaphoreResourceString) {
                console.log(
                    `In ${this.processName} process pid ${this.pid}, redis cleaner releasing k8 job semaphore ${this.lastK8JobSemaphoreResourceString}`
                );
                KubernetesService.singleton.jobVacancySemaphore &&
                    (await KubernetesService.singleton.jobVacancySemaphore.release());
                this.lastK8JobSemaphoreResourceString = undefined;
            } else if (this.lastTravisJobSemaphoreResourceString) {
                console.log(
                    `In ${this.processName} process pid ${this.pid}, redis cleaner releasing k8 job semaphore ${this.lastTravisJobSemaphoreResourceString}`
                );
                TravisManager.singleton.travisJobResourceSemaphore &&
                    (await TravisManager.singleton.travisJobResourceSemaphore.release());
                this.lastTravisJobSemaphoreResourceString = undefined;
            }

            // release redis clients

            await cleanupRedisSubscriptionConnection(
                this.lastRedisPubsubChannelName,
                this.lastRedisClientSubscription,
                this.lastRedisClientPublish,
                this.lastOrg,
                this.lastJobIdString
            );

            // reset all `last...` attribute so that in case this process is reused,
            // already cleaned resources don't get clean up again,
            // which will cause issues like accidentally releasing other process's
            // travis semaphore, even if this process uses k8 job semaphore
            this.lastRedisPubsubChannelName = this.lastRedisClientSubscription = this.lastRedisClientPublish = this.lastOrg = this.lastJobIdString = this.runtimePlatformDescriptor = undefined;

            // cancel any travis jobs
            const cancelResults = await TravisManager.singleton.cancelAllJobs();
            console.debug(
                `In ${this.processName} process pid ${
                    this.pid
                }, resource cleaner canceling travis jobs result: ${JSON.stringify(
                    cancelResults
                )}`
            );

            // cancel any travis manager schedulers
            TravisManager.singleton.clearAllSchedulers();

            return;
        }

        console.log(
            `In ${this.processName} process pid ${this.pid}, redis cleaner has insufficient arguments so skipping clean up`
        );
    }
}

const processResourceCleaner = ScraperJobProcessResourcesCleaner.singleton;

const abortSubscription = (
    message: string,
    payload: string,
    timeoutTimer: NodeJS.Timer,
    rejector: (reason?: string) => void
) => {
    const errorMessage = `${message}, payload:` + payload;
    console.warn(errorMessage);
    clearTimeout(timeoutTimer);
    return rejector(errorMessage);
};

/**
 *
 * @param channel
 * @param message - of form '<type>:<payload>'
 * @param scraperSupervisorResolve
 * @param scraperSupervisorReject
 */
const onReceiveScraperJobMessage = async (
    jobId: string,
    jobProgressBar: ProgressBarManager,
    channel: string,
    message: string,
    redisClientPublish: IORedis.Redis,
    scraperSupervisorResolve: (value?: string | ScraperCrossRequest) => void,
    scraperSupervisorReject: (reason?: string) => void,
    timeoutTimer: NodeJS.Timer
): Promise<string | ScraperCrossRequest | undefined | void> => {
    console.log(`job ${jobId} received message from channel`, channel);

    const [type, messageTo, ...payload] = message.split(':');
    const payloadAsString = payload.join(':');

    if (
        messageTo !== ScraperJobMessageTo.SLACK_MD_SVC &&
        messageTo !== ScraperJobMessageTo.ALL
    ) {
        console.debug(
            `job ${jobId} ignoring messages that are not for us`,
            message
        );
        return;
    }

    if (type === ScraperJobMessageType.PREFLIGHT) {
        console.log(`job ${jobId}`, 'preflight received', payload);
        if (
            !(await redisClientPublish.publish(
                channel,
                composePubsubMessage(
                    ScraperJobMessageType.PREFLIGHT,
                    ScraperJobMessageTo.SCRAPER,
                    'acknowledged'
                )
            ))
        ) {
            return abortSubscription(
                `job ${jobId} respond to preflight message but no client is listening / receives it`,
                payloadAsString,
                timeoutTimer,
                scraperSupervisorReject
            );
        }

        await jobProgressBar.increment();

        return;
    } else if (type === ScraperJobMessageType.PROGRESS) {
        // TODO: validate progress data; but have to handle optional props first, do this in class `ScraperProgress`.
        const progressData = JSON.parse(payloadAsString) as ScraperProgressData;
        console.log(
            `job ${jobId} (pid ${process.pid}) progress reported`,
            progressData
        );

        jobProgressBar.syncSetRelativePercentage(
            progressData.wentThrough,
            progressData.total
        );

        return;
    } else if (type === ScraperJobMessageType.FINISH) {
        clearTimeout(timeoutTimer);

        // travis job should end soon so don't bother cleaning up travis job
        TravisManager.singleton.resetTrackingJobs();

        if (payloadAsString === 'OK!') {
            return scraperSupervisorResolve(
                `job ${jobId} scraper job reported finish: ` + payload
            );
        } else {
            const crossData = ScraperCrossRequest.parseFromMessagePayloadString(
                payloadAsString
            );
            console.debug(
                `job ${jobId} scraper job reported finish, but received renewal job request data`,
                crossData
            );
            return scraperSupervisorResolve(crossData);
        }
    } else if (type === ScraperJobMessageType.ERROR) {
        // travis job should end soon so don't bother cleaning up travis job
        TravisManager.singleton.resetTrackingJobs();

        return abortSubscription(
            `job ${jobId} scraper job reported error`,
            payloadAsString,
            timeoutTimer,
            scraperSupervisorReject
        );
    } else if (type === ScraperJobMessageType.TERMINATE) {
        // treat manual termination as success job so that
        // the job won't be re-attempted by attempts setting of queue

        clearTimeout(timeoutTimer);

        return scraperSupervisorResolve(`job${jobId}:manuallyTerminated`);
    } else {
        return abortSubscription(
            `job ${jobId} Received unknown type '${type}'`,
            payloadAsString,
            timeoutTimer,
            scraperSupervisorReject
        );
    }
};

const getMessageTimeoutTimer = (
    job: Bull.Job<ScraperJobRequestData>,
    org: string = 'null',
    redisPubsubChannelName: string,
    scraperSupervisorReject: (reason?: string) => void
) =>
    setTimeout(async () => {
        console.warn(
            `job ${job.id} timed out after ` +
                TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS +
                ' ms'
        );

        await asyncSendSlackMessage(
            `Supervisor job ${job.id} on ${processResourceCleaner.runtimePlatformDescriptor} timed out ${TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS}ms while supervising scraper job for org ${org}; pubsub channel is \`${redisPubsubChannelName}\``
        );

        return scraperSupervisorReject(
            `job ${job.id} for org ${org} on ${processResourceCleaner.runtimePlatformDescriptor} timed out ${TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS}ms while supervising scraper job; pubsub channel is \`${redisPubsubChannelName}\``
        );
    }, TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS);

/**
 * Adds double quote to orgName if necessary when orgName presents
 *
 * @param scraperJobRequestData - The params data when adding the job
 */
const patchOrgNameOnScraperJobRequestData = (
    scraperJobRequestData: ScraperJobRequestData
): ScraperJobRequestData => {
    if (!scraperJobRequestData.orgName) {
        return scraperJobRequestData;
    }

    let patchedOrgName = scraperJobRequestData.orgName;
    if (!patchedOrgName.startsWith('"')) {
        patchedOrgName = `\"${patchedOrgName}`;
    }

    if (!patchedOrgName.endsWith('"')) {
        patchedOrgName = `${patchedOrgName}\"`;
    }

    return {
        ...scraperJobRequestData,
        orgName: patchedOrgName
    };
};

const superviseScraper = (
    job: Bull.Job<ScraperJobRequestData>,
    redisPubsubChannelName: string,
    redisClientSubscription: IORedis.Redis,
    redisClientPublish: IORedis.Redis
) => {
    const progressBarManager = ProgressBarManager.newProgressBarManager(
        JobQueueName.GD_ORG_REVIEW_SCRAPER_JOB,
        job,
        job.data.lastProgress ? job.data.lastProgress.total : undefined,
        job.data.lastProgress ? job.data.lastProgress.wentThrough : undefined
    );

    // check channel name locker first
    // if the channel already exists, then reject this job
    return redisClientPublish
        .get(`lock:${redisPubsubChannelName}`)
        .then(lockValue => {
            console.debug(
                `job ${job.id} checking lock first,`,
                `lock:${redisPubsubChannelName} =`,
                lockValue
            );
            if (lockValue) {
                console.error(
                    `Channel ${redisPubsubChannelName} locked, invalidating & aborting job ${job.id}, job params:`,
                    job.data
                );
                return asyncSendSlackMessage(
                    `ERROR: Channel ${redisPubsubChannelName} locked but job is trying to subscribe to it; aborting scraper job ${
                        job.id
                    }, job params are\n\`\`\`${JSON.stringify(job.data)}\`\`\``
                ).then(() => {
                    throw Error(`channelLocked`);
                });
            } else {
                console.debug('no lock, will allow scraper job', job.id);
                return;
            }
        })
        .then(
            () =>
                new Promise<string | ScraperCrossRequest>(
                    (scraperSupervisorResolve, scraperSupervisorReject) => {
                        let timeoutTimer = getMessageTimeoutTimer(
                            job,
                            job.data.orgName || job.data.orgInfo,
                            redisPubsubChannelName,
                            scraperSupervisorReject
                        );

                        redisClientSubscription.on(
                            'message',
                            async (channel, message) => {
                                clearTimeout(timeoutTimer);
                                timeoutTimer = getMessageTimeoutTimer(
                                    job,
                                    job.data.orgName || job.data.orgInfo,
                                    redisPubsubChannelName,
                                    scraperSupervisorReject
                                );

                                return await onReceiveScraperJobMessage(
                                    job.id.toString(),
                                    progressBarManager,
                                    channel,
                                    message,
                                    redisClientPublish,
                                    scraperSupervisorResolve,
                                    scraperSupervisorReject,
                                    timeoutTimer
                                );
                            }
                        );

                        redisClientSubscription
                            .subscribe(
                                redisPubsubChannelName,
                                RedisPubSubChannelName.ADMIN
                            )
                            .then(async count => {
                                console.log(
                                    `job ${job.id} subscribed to channels [${redisPubsubChannelName},${RedisPubSubChannelName.ADMIN}], count ${count}`
                                );

                                // after subscribing, register it to locker, so that no other scrpaer job can subscribe to
                                // the same channel (no other job working on the same org)
                                await redisClientPublish.set(
                                    `lock:${redisPubsubChannelName}`,
                                    job.id
                                );

                                // `ioredis` will only run this callback once upon subscribed
                                // so no need to filter out which channel it is, as oppose to `node-redis`

                                const travisSemaphoreResourceString = await checkTravisHasVacancy(
                                    redisPubsubChannelName
                                );

                                if (
                                    KubernetesService.singleton
                                        .jobVacancySemaphore &&
                                    !travisSemaphoreResourceString
                                ) {
                                    // run on k8s

                                    processResourceCleaner.runtimePlatformDescriptor =
                                        'k8s/waitingForSemaphore';

                                    console.log(
                                        // 'In development environment, skipping travis request. Please run scraper locally if needed'
                                        // 'In dev env, using k8 job'
                                        'no travis vacancy available, try to use k8 job'
                                    );

                                    try {
                                        ScraperJobProcessResourcesCleaner.singleton.lastK8JobSemaphoreResourceString = await KubernetesService.singleton.jobVacancySemaphore.acquire();
                                    } catch (error) {
                                        return scraperSupervisorReject(error);
                                    }

                                    console.log(
                                        `job ${job.id} got k8 job semaphore ${ScraperJobProcessResourcesCleaner.singleton.lastK8JobSemaphoreResourceString}`
                                    );

                                    let k8Job;
                                    try {
                                        k8Job = await KubernetesService.singleton.asyncAddScraperJob(
                                            job.data
                                        );
                                    } catch (error) {
                                        const errorMessage = `job ${
                                            job.id
                                        } error when requesting k8 job: ${JSON.stringify(
                                            error
                                        )}`;
                                        console.error(
                                            `job ${job.id} error when requesting k8 job:`,
                                            error
                                        );
                                        return scraperSupervisorReject(
                                            errorMessage
                                        );
                                    }

                                    await progressBarManager.increment();

                                    processResourceCleaner.runtimePlatformDescriptor = `k8s/${
                                        k8Job.body.metadata
                                            ? k8Job.body.metadata.selfLink
                                            : ''
                                    }`;

                                    console.log(
                                        `job ${job.id} request k8 job successfully:`,
                                        k8Job.body.metadata
                                    );

                                    return;
                                } else if (
                                    TravisManager.singleton
                                        .travisJobResourceSemaphore &&
                                    travisSemaphoreResourceString
                                ) {
                                    // run on travis

                                    processResourceCleaner.runtimePlatformDescriptor =
                                        'travis/waitingForSemaphore';

                                    ScraperJobProcessResourcesCleaner.singleton.lastTravisJobSemaphoreResourceString = travisSemaphoreResourceString;

                                    const confirmedTravisJobRequest = await TravisManager.singleton.asyncTriggerJob(
                                        job.data
                                    );

                                    console.debug(
                                        `job ${job.id} travis build created successfully: `,
                                        confirmedTravisJobRequest.builds
                                    );

                                    await progressBarManager.increment();

                                    processResourceCleaner.runtimePlatformDescriptor = `travis/${confirmedTravisJobRequest.builds
                                        .map(build => build.id)
                                        .join(',')}`;

                                    return;
                                } else {
                                    return scraperSupervisorReject(
                                        `No platform available to run scraper, please check platform concurrency config`
                                    );
                                }
                            });
                    }
                )
        );
};

module.exports = function (job: Bull.Job<ScraperJobRequestData>) {
    console.log(
        `scraper job ${job.id} started processing, with params`,
        job.data
    );
    processResourceCleaner.lastJobIdString = job.id.toString();
    processResourceCleaner.processName = 'scraperJob sandbox';

    const patchedJob: Bull.Job<ScraperJobRequestData> = {
        ...job,
        data: patchOrgNameOnScraperJobRequestData(job.data)
    };
    processResourceCleaner.lastOrg =
        patchedJob.data.orgInfo || patchedJob.data.orgName || 'null';

    console.log(`scraper job ${patchedJob.id} patched params`, patchedJob.data);

    const redisClientSubscription = (processResourceCleaner.lastRedisClientSubscription = redisManager.newClient());
    const redisClientPublish = (processResourceCleaner.lastRedisClientPublish = redisManager.newClient());
    const redisPubsubChannelName = (processResourceCleaner.lastRedisPubsubChannelName =
        patchedJob.data.pubsubChannelName);

    return superviseScraper(
        patchedJob,
        redisPubsubChannelName,
        redisClientSubscription,
        redisClientPublish
    )
        .then(resultMessage => Promise.resolve(resultMessage))
        .catch(error => {
            if (typeof error === 'string') {
                throw new Error(
                    `platform: ${
                        processResourceCleaner.runtimePlatformDescriptor
                    }\n${error}\nJob params: ${JSON.stringify(job.data)}`
                );
            } else if (error instanceof Error) {
                error.message += `\nJob params: ${JSON.stringify(job.data)}`;
                throw error;
            }

            throw error;
        })
        .finally(() => {
            return processResourceCleaner.asyncCleanup();
        });
};

(['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[]).forEach(
    terminateEventName => {
        process.on(terminateEventName, () => {
            console.log(
                `In process pid ${process.pid} received termination signal ${terminateEventName}`
            );
            return processResourceCleaner
                .asyncCleanup()
                .then(() => {
                    console.log(
                        'finished best effort to clean up locks and redis connections'
                    );
                    process.exit(0);
                })
                .catch(error => {
                    console.error(error);
                    console.log(
                        'error while best effort cleaning up locks and redis connections, skipping'
                    );
                    process.exit(1);
                });
        });
    }
);
