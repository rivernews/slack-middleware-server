import Bull from 'bull';
import Redis from 'redis';
import { redisConnectionConfig, RedisPubSubChannelName } from '../../../redis';
import { ScraperJobData } from './queue';
import { asyncTriggerQualitativeReviewRepoBuild } from '../../../travis';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

const TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS = 30 * 60 * 1000;

enum ScraperJobMessageType {
    PREFLIGHT = 'preflight',
    PROGRESS = 'progress',
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

/**
 *
 * @param channel
 * @param message - of form '<type>:<payload>'
 * @param scraperSupervisorResolve
 * @param scraperSupervisorReject
 */
const onReceiveScraperJobMessage = (
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
        return;
    } else if (type === ScraperJobMessageType.PROGRESS) {
        console.log('progress reported', payload);
        return;
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
    orgInfo: string,
    redisClientSubscription: Redis.RedisClient,
    redisClientPublish: Redis.RedisClient
) => {
    return new Promise<string>(
        (scraperSupervisorResolve, scraperSupervisorReject) => {
            let timeoutTimer = getMessageTimeoutTimer(
                orgInfo,
                scraperSupervisorReject
            );

            redisClientSubscription.on('subscribe', async () => {
                console.log(
                    `subscribed to channel ${RedisPubSubChannelName.SCRAPER_JOB_CHANNEL}`
                );
                // TODO: POST travis API to trigger scraper job
                const triggerTravisJobRequest = await asyncTriggerQualitativeReviewRepoBuild(
                    orgInfo,
                    '024_cronjob_support'
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

                const travisJob = triggerTravisJobRequest.data;

                console.log(
                    `request travis job successfully: ${travisJob.request.id}/${travisJob['@type']}, remaining_requests=${travisJob['remaining_requests']}`
                );
            });
            redisClientSubscription.on('message', (channel, message) => {
                clearTimeout(timeoutTimer);
                timeoutTimer = getMessageTimeoutTimer(
                    orgInfo,
                    scraperSupervisorReject
                );

                return onReceiveScraperJobMessage(
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
            job.data.orgInfo,
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
