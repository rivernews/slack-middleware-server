import Bull from 'bull';
import Redis from 'redis';
import { redisConnectionConfig, RedisPubSubChannelName } from '../../../redis';
import {
    ScraperJobData,
    gdOrgReviewScraperJobQueue,
    ScraperProgressData,
    ScraperMode
} from './queue';
import { asyncTriggerQualitativeReviewRepoBuild } from '../../../travis';
import { asyncSendSlackMessage } from '../../../slack';
import { RuntimeEnvironment } from '../../../../utilities/runtime';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

// scraper job in travis will publish request ack around 1 min 15 sec after travis build scheduled
// so 2 min of timeout waiting that publish message should be just right
const TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS = 2 * 60 * 1000;

enum ScraperJobMessageType {
    PREFLIGHT = 'preflight',
    PROGRESS = 'progress',

    // scraper wants to do a cross-session job
    CROSS = 'cross',

    FINISH = 'finish',
    ERROR = 'error'
}

enum ScraperJobMessageTo {
    SLACK_MD_SVC = 'slackMiddlewareService',
    SCRAPER = 'scraper'
}

const abortSubscription = (
    message: string,
    payload: string[],
    timeoutTimer: NodeJS.Timer,
    rejector: (reason?: string) => void
) => {
    const errorMessage = `${message}, payload:` + payload;
    console.warn(errorMessage);
    clearTimeout(timeoutTimer);
    return rejector(errorMessage);
};

const parsePayload = (payload: string[]) => {
    const jsonString = payload.join(':');
    return JSON.parse(jsonString);
};

type ScraperCrossRequestData = ScraperJobData & {
    ordId: string;
    orgName: string;
    lastProgress: ScraperProgressData;
    lastReviewPage: string;
    scrapeMode: ScraperMode;
};

/**
 *
 * @param channel
 * @param message - of form '<type>:<payload>'
 * @param scraperSupervisorResolve
 * @param scraperSupervisorReject
 */
const onReceiveScraperJobMessage = async (
    job: Bull.Job<ScraperJobData>,
    channel: string,
    message: string,
    redisClientPublish: Redis.RedisClient,
    scraperSupervisorResolve: (
        value?: string | PromiseLike<string> | undefined
    ) => void,
    scraperSupervisorReject: (reason?: string) => void,
    timeoutTimer: NodeJS.Timer
) => {
    console.log(`job ${job.id} received message from channel`, channel);

    const [type, messageTo, ...payload] = message.split(':');

    if (messageTo !== ScraperJobMessageTo.SLACK_MD_SVC) {
        console.debug(
            `job ${job.id} ignoring messages that are not for us`,
            message
        );
        return;
    }

    if (type === ScraperJobMessageType.PREFLIGHT) {
        console.log(`job ${job.id}`, 'preflight received', payload);
        if (
            !redisClientPublish.publish(
                channel,
                `${ScraperJobMessageType.PREFLIGHT}:${ScraperJobMessageTo.SCRAPER}:acknowledged`
            )
        ) {
            return abortSubscription(
                `job ${job.id} fail to respond to preflight message`,
                payload,
                timeoutTimer,
                scraperSupervisorReject
            );
        }

        job.progress(job.progress() + 1);

        return;
    } else if (type === ScraperJobMessageType.PROGRESS) {
        const progressData = parsePayload(payload) as ScraperProgressData;
        console.log(`job ${job.id} progress reported`, progressData);

        job.progress(
            parseFloat(
                (
                    (progressData.wentThrough / progressData.total) *
                    100.0
                ).toFixed(2)
            )
        );

        return;
    } else if (type === ScraperJobMessageType.CROSS) {
        clearTimeout(timeoutTimer);

        const crossData = parsePayload(payload) as ScraperCrossRequestData;
        console.log(
            `job ${job.id} cross session wanted`,
            crossData,
            'will finalize this job and start another one to continue'
        );

        const crossSessionJob = await gdOrgReviewScraperJobQueue.add(crossData);
        console.log('dispatched job for cross session', crossSessionJob.id);

        // do not resolve / done() job here
        // must wait till scraper's FINISH message then mark job as done()
        // otherwise scraper's FINISH will kill
        return;
    } else if (type === ScraperJobMessageType.FINISH) {
        clearTimeout(timeoutTimer);

        const message = `job ${job.id} scraper job reported finish: ` + payload;
        console.log(message);

        return scraperSupervisorResolve(message);
    } else if (type === ScraperJobMessageType.ERROR) {
        return abortSubscription(
            `job ${job.id} scraper job reported error`,
            payload,
            timeoutTimer,
            scraperSupervisorReject
        );
    } else {
        return abortSubscription(
            `job ${job.id} Received unknown type '${type}'`,
            payload,
            timeoutTimer,
            scraperSupervisorReject
        );
    }
};

const getMessageTimeoutTimer = (
    jobId: string,
    org: string = 'null',
    scraperSupervisorReject: (reason?: string) => void
) =>
    setTimeout(async () => {
        console.warn(
            `job ${jobId} timed out after ` +
                TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS +
                ' ms'
        );

        await asyncSendSlackMessage(
            `Supervisor job ${jobId} timed out while supervising scraper job for org ${org}`
        );

        return scraperSupervisorReject(
            `job ${jobId} for org ${org} timed out while supervising travis scraper job`
        );
    }, TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS);

const superviseScraper = (
    job: Bull.Job<ScraperJobData>,
    redisPubsubChannelName: string,
    redisClientSubscription: Redis.RedisClient,
    redisClientPublish: Redis.RedisClient
) => {
    return new Promise<string>(
        async (scraperSupervisorResolve, scraperSupervisorReject) => {
            let timeoutTimer = getMessageTimeoutTimer(
                job.id.toString(),
                job.data.orgInfo || job.data.orgName,
                scraperSupervisorReject
            );

            redisClientSubscription.on('subscribe', async () => {
                console.log(
                    `job ${job.id} subscribed to channel ${redisPubsubChannelName}`
                );
                const triggerTravisJobRequest = await asyncTriggerQualitativeReviewRepoBuild(
                    job.data,
                    {
                        branch: '026_dataintegrity_review_helpfulcount'
                    }
                );
                if (triggerTravisJobRequest.status >= 400) {
                    const errorMessage =
                        `job ${job.id} error when requesting travis job: ` +
                        JSON.stringify(triggerTravisJobRequest.data);
                    console.error(
                        `job ${job.id} error when requesting travis job:`,
                        triggerTravisJobRequest.data
                    );
                    return scraperSupervisorReject(errorMessage);
                }

                job.progress(job.progress() + 1);

                const travisJob = triggerTravisJobRequest.data;

                console.log(
                    `job ${job.id} request travis job successfully: ${travisJob.request.id}/${travisJob['@type']}, remaining_requests=${travisJob['remaining_requests']}`
                );
            });
            redisClientSubscription.on('message', (channel, message) => {
                clearTimeout(timeoutTimer);
                timeoutTimer = getMessageTimeoutTimer(
                    job.id.toString(),
                    job.data.orgInfo || job.data.orgName,
                    scraperSupervisorReject
                );

                return onReceiveScraperJobMessage(
                    job,
                    channel,
                    message,
                    redisClientPublish,
                    scraperSupervisorResolve,
                    scraperSupervisorReject,
                    timeoutTimer
                );
            });
            redisClientSubscription.subscribe(redisPubsubChannelName);
        }
    );
};

const cleanupRedisSubscriptionConnection = (
    redisPubsubChannelName: string,
    redisClientSubscription: Redis.RedisClient,
    redisClientPublish: Redis.RedisClient,
    org: string = 'null'
) => {
    if (redisClientSubscription.unsubscribe()) {
        console.log(
            `unsubscribed channel ${redisPubsubChannelName} successfully, org:`,
            org
        );
        redisClientSubscription.quit();
        redisClientPublish.quit();
    } else {
        console.error(
            `Failed to unsubscribe pubsub for travis scraper job, org: ${org}`
        );
    }
};

module.exports = function (job: Bull.Job<ScraperJobData>) {
    console.log(`scraper job ${job.id} started processing`);

    const redisClientSubscription = Redis.createClient(redisConnectionConfig);
    const redisClientPublish = redisClientSubscription.duplicate();
    const redisPubsubChannelName = `${
        RedisPubSubChannelName.SCRAPER_JOB_CHANNEL
    }:${job.data.orgInfo || job.data.orgName}:${
        job.data.lastProgress ? job.data.lastProgress.processedSession : 0
    }`;

    return new Promise((resolve, reject) => {
        try {
            setTimeout(() => {
                resolve('times up!');
            }, 5000);
        } catch (error) {
            reject(error);
        }
    });

    // return superviseScraper(
    //     job,
    //     redisPubsubChannelName,
    //     redisClientSubscription,
    //     redisClientPublish
    // )
    //     .then(resultMessage => {
    //         cleanupRedisSubscriptionConnection(
    //             redisPubsubChannelName,
    //             redisClientSubscription,
    //             redisClientPublish,
    //             job.data.orgInfo || job.data.orgName
    //         );
    //         return Promise.resolve(resultMessage);
    //     })
    //     .catch(error => {
    //         cleanupRedisSubscriptionConnection(
    //             redisPubsubChannelName,
    //             redisClientSubscription,
    //             redisClientPublish,
    //             job.data.orgInfo || job.data.orgName
    //         );
    //         return Promise.reject(error);
    //     });
};
