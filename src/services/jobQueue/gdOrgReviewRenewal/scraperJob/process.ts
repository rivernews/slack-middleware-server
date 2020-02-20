import Bull from 'bull';
import Redis, { RedisClient } from 'redis';
import { redisConnectionConfig, RedisPubSubChannelName } from '../../../redis';
import { ScraperJobData } from './queue';
import { asyncTriggerQualitativeReviewRepoBuild } from '../../../travis';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

const TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS = 10 * 1000;

enum ScraperJobMessageType {
    PROGRESS = 'progress',
    FINISH = 'finish',
    ERROR = 'error'
}

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
    scraperSupervisorResolve: (
        value?: string | PromiseLike<string> | undefined
    ) => void,
    scraperSupervisorReject: (reason?: string) => void,
    timeoutTimer: NodeJS.Timer
) => {
    console.log('received message from channel', channel);

    const [type, ...payload] = message.split(':');
    if (type === ScraperJobMessageType.PROGRESS) {
        console.log('progress reported', payload);
        return;
    } else if (type === ScraperJobMessageType.FINISH) {
        const message = 'scraper job reported finish: ' + payload;
        console.log(message);
        clearTimeout(timeoutTimer);
        return scraperSupervisorResolve(message);
    } else if (type === ScraperJobMessageType.ERROR) {
        const errorMessage = 'scraper job reported error: ' + payload;
        console.warn(errorMessage);
        clearTimeout(timeoutTimer);
        return scraperSupervisorReject(errorMessage);
    } else {
        const errorMessage =
            'Received unknown type message: ' + type + ', payload: ' + payload;
        console.error(errorMessage);
        clearTimeout(timeoutTimer);
        return scraperSupervisorReject(errorMessage);
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
    redisClientSubscription: Redis.RedisClient
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
                    orgInfo
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
    redisClientSubscription: RedisClient,
    orgInfo: string
) => {
    if (redisClientSubscription.unsubscribe()) {
        console.log(
            `unsubscribed channel ${RedisPubSubChannelName.SCRAPER_JOB_CHANNEL} successfully, orgInfo:`,
            orgInfo
        );
        redisClientSubscription.quit();
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

    let resultMessage;
    try {
        // only let job finish if receive finish signal from pubsub
        resultMessage = await superviseScraper(
            job.data.orgInfo,
            redisClientSubscription
        );
    } catch (error) {
        cleanupRedisSubscriptionConnection(
            redisClientSubscription,
            job.data.orgInfo
        );
        return done(error);
    }

    cleanupRedisSubscriptionConnection(
        redisClientSubscription,
        job.data.orgInfo
    );

    return done(null, {
        resultMessage
    });
    // return Promise.resolve(result);
};
