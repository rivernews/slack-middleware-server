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

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

const TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS = 30 * 60 * 1000;

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

type ProgressFunction = (value?: number) => any;

const parsePayload = (payload: string[]) => {
    const jsonString = payload.join(':');
    return JSON.parse(jsonString);
};

type ScraperCrossRequestData = ScraperJobData & {
    ordId: string;
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
    jobProgress: ProgressFunction,
    channel: string,
    message: string,
    redisClientPublish: Redis.RedisClient,
    scraperSupervisorResolve: (
        value?: string | PromiseLike<string> | undefined
    ) => void,
    scraperSupervisorReject: (reason?: string) => void,
    timeoutTimer: NodeJS.Timer
) => {
    console.log('received message from channel', channel);

    const [type, messageTo, ...payload] = message.split(':');

    if (messageTo !== ScraperJobMessageTo.SLACK_MD_SVC) {
        console.debug('ignoring messages that are not for us', message);
        return;
    }

    if (type === ScraperJobMessageType.PREFLIGHT) {
        console.log('preflight received', payload);
        if (
            !redisClientPublish.publish(
                RedisPubSubChannelName.SCRAPER_JOB_CHANNEL,
                `${ScraperJobMessageType.PREFLIGHT}:${ScraperJobMessageTo.SCRAPER}:acknowledged`
            )
        ) {
            return abortSubscription(
                'fail to respond to preflight message',
                payload,
                timeoutTimer,
                scraperSupervisorReject
            );
        }

        jobProgress(jobProgress() + 1);

        return;
    } else if (type === ScraperJobMessageType.PROGRESS) {
        const progressData = parsePayload(payload) as ScraperProgressData;
        console.log('progress reported', progressData);

        jobProgress(
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
            'cross session wanted',
            crossData,
            'will finalize this job and start another one to continue'
        );

        const job = await gdOrgReviewScraperJobQueue.add(crossData);
        console.log('dispatched job for cross session', job.id);

        return scraperSupervisorResolve(
            `scraper job wants cross session job ${job.id} to continue, no error so far`
        );
    } else if (type === ScraperJobMessageType.FINISH) {
        clearTimeout(timeoutTimer);

        const message = 'scraper job reported finish: ' + payload;
        console.log(message);

        return scraperSupervisorResolve(message);
    } else if (type === ScraperJobMessageType.ERROR) {
        return abortSubscription(
            'scraper job reported error',
            payload,
            timeoutTimer,
            scraperSupervisorReject
        );
    } else {
        return abortSubscription(
            `Received unknown type '${type}'`,
            payload,
            timeoutTimer,
            scraperSupervisorReject
        );
    }
};

const getMessageTimeoutTimer = (
    orgInfo: string,
    scraperSupervisorReject: (reason?: string) => void
) =>
    setTimeout(() => {
        console.warn(
            'timed out after ' +
                TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS +
                ' ms'
        );
        return scraperSupervisorReject(
            `job for org ${orgInfo} timed out while supervising travis scraper job`
        );
    }, TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS);

const superviseScraper = (
    job: Bull.Job<ScraperJobData>,
    redisClientSubscription: Redis.RedisClient,
    redisClientPublish: Redis.RedisClient
) => {
    return new Promise<string>(
        async (scraperSupervisorResolve, scraperSupervisorReject) => {
            let timeoutTimer = getMessageTimeoutTimer(
                job.data.orgInfo,
                scraperSupervisorReject
            );

            redisClientSubscription.on('subscribe', async () => {
                console.log(
                    `subscribed to channel ${RedisPubSubChannelName.SCRAPER_JOB_CHANNEL}`
                );
                const triggerTravisJobRequest = await asyncTriggerQualitativeReviewRepoBuild(
                    job.data,
                    {
                        branch: '026_dataintegrity_review_helpfulcount'
                    }
                );
                if (triggerTravisJobRequest.status >= 400) {
                    const errorMessage =
                        'Error when requesting travis job: ' +
                        JSON.stringify(triggerTravisJobRequest.data);
                    console.error(
                        'Error when requesting travis job:',
                        triggerTravisJobRequest.data
                    );
                    return scraperSupervisorReject(errorMessage);
                }

                job.progress(job.progress() + 1);

                const travisJob = triggerTravisJobRequest.data;

                console.log(
                    `request travis job successfully: ${travisJob.request.id}/${travisJob['@type']}, remaining_requests=${travisJob['remaining_requests']}`
                );
            });
            redisClientSubscription.on('message', (channel, message) => {
                clearTimeout(timeoutTimer);
                timeoutTimer = getMessageTimeoutTimer(
                    job.data.orgInfo,
                    scraperSupervisorReject
                );

                return onReceiveScraperJobMessage(
                    job.progress,
                    channel,
                    message,
                    redisClientPublish,
                    scraperSupervisorResolve,
                    scraperSupervisorReject,
                    timeoutTimer
                );
            });
            redisClientSubscription.subscribe(
                RedisPubSubChannelName.SCRAPER_JOB_CHANNEL
            );
        }
    );
};

const cleanupRedisSubscriptionConnection = (
    redisClientSubscription: Redis.RedisClient,
    redisClientPublish: Redis.RedisClient,
    orgInfo: string
) => {
    if (redisClientSubscription.unsubscribe()) {
        console.log(
            `unsubscribed channel ${RedisPubSubChannelName.SCRAPER_JOB_CHANNEL} successfully, orgInfo:`,
            orgInfo
        );
        redisClientSubscription.quit();
        redisClientPublish.quit();
    } else {
        console.error(
            `Failed to unsubscribe pubsub for travis scraper job, orgInfo: ${orgInfo}`
        );
    }
};

module.exports = async function (
    job: Bull.Job<ScraperJobData>,
    done: Bull.DoneCallback
) {
    const redisClientSubscription = Redis.createClient(redisConnectionConfig);
    const redisClientPublish = redisClientSubscription.duplicate();

    let resultMessage;
    try {
        // only let job finish if receive finish signal from pubsub
        resultMessage = await superviseScraper(
            job,
            redisClientSubscription,
            redisClientPublish
        );
    } catch (error) {
        cleanupRedisSubscriptionConnection(
            redisClientSubscription,
            redisClientPublish,
            job.data.orgInfo
        );
        return done(error);
    }

    cleanupRedisSubscriptionConnection(
        redisClientSubscription,
        redisClientPublish,
        job.data.orgInfo
    );

    return done(null, {
        resultMessage
    });
    // return Promise.resolve(result);
};
