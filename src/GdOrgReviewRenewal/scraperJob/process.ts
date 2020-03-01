import Bull from 'bull';
import Redis from 'redis';
import { redisManager, RedisPubSubChannelName } from '../../services/redis';
import { asyncTriggerQualitativeReviewRepoBuild } from '../../services/travis';
import { asyncSendSlackMessage } from '../../services/slack';
import {
    ScraperJobRequestData,
    ScraperCrossRequest,
    ScraperJobMessageTo,
    ScraperJobMessageType,
    ScraperProgressData
} from '../../services/jobQueue/types';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

// scraper job in travis will publish request ack around 1 min 15 sec after travis build scheduled
// so 4 min of timeout waiting that publish message should be just right
const TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS = 4 * 60 * 1000;

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
    job: Bull.Job<ScraperJobRequestData>,
    channel: string,
    message: string,
    redisClientPublish: Redis.RedisClient,
    scraperSupervisorResolve: (value?: string | ScraperCrossRequest) => void,
    scraperSupervisorReject: (reason?: string) => void,
    timeoutTimer: NodeJS.Timer
): Promise<string | ScraperCrossRequest | undefined | void> => {
    console.log(`job ${job.id} received message from channel`, channel);

    const [type, messageTo, ...payload] = message.split(':');
    const payloadAsString = payload.join(':');

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
                payloadAsString,
                timeoutTimer,
                scraperSupervisorReject
            );
        }

        job.progress(job.progress() + 1);

        return;
    } else if (type === ScraperJobMessageType.PROGRESS) {
        // TODO: validate progress data; but have to handle optional props first, do this in class `ScraperProgress`.
        const progressData = JSON.parse(payloadAsString) as ScraperProgressData;
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
    } else if (type === ScraperJobMessageType.FINISH) {
        clearTimeout(timeoutTimer);
        if (payloadAsString === 'OK!') {
            return scraperSupervisorResolve(
                `job ${job.id} scraper job reported finish: ` + payload
            );
        } else {
            const crossData = ScraperCrossRequest.parseFromMessagePayloadString(
                payloadAsString
            );
            console.debug(
                `job ${job.id} scraper job reported finish, but received renewal job request data`,
                crossData
            );
            return scraperSupervisorResolve(crossData);
        }
    } else if (type === ScraperJobMessageType.ERROR) {
        return abortSubscription(
            `job ${job.id} scraper job reported error`,
            payloadAsString,
            timeoutTimer,
            scraperSupervisorReject
        );
    } else {
        return abortSubscription(
            `job ${job.id} Received unknown type '${type}'`,
            payloadAsString,
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
            `Supervisor job ${jobId} timed out ${TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS}ms while supervising scraper job for org ${org}`
        );

        return scraperSupervisorReject(
            `job ${jobId} for org ${org} timed out ${TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS}ms while supervising travis scraper job`
        );
    }, TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS);

const superviseScraper = (
    job: Bull.Job<ScraperJobRequestData>,
    redisPubsubChannelName: string,
    redisClientSubscription: Redis.RedisClient,
    redisClientPublish: Redis.RedisClient
) => {
    return new Promise<string | ScraperCrossRequest>(
        (scraperSupervisorResolve, scraperSupervisorReject) => {
            let timeoutTimer = getMessageTimeoutTimer(
                job.id.toString(),
                job.data.orgInfo || job.data.orgName,
                scraperSupervisorReject
            );

            redisClientSubscription.on('subscribe', async () => {
                console.log(
                    `job ${job.id} subscribed to channel ${redisPubsubChannelName}`
                );

                // remove this block if want to run scraper on local for debugging
                // if (process.env.NODE_ENV !== RuntimeEnvironment.PRODUCTION) {
                //     console.log('not in production, skipping travis request. Please run scraper locally if needed');
                //     return;
                // }

                const triggerTravisJobRequest = await asyncTriggerQualitativeReviewRepoBuild(
                    job.data,
                    {
                        branch: 'master'
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

            redisClientSubscription.on('message', async (channel, message) => {
                clearTimeout(timeoutTimer);
                timeoutTimer = getMessageTimeoutTimer(
                    job.id.toString(),
                    job.data.orgInfo || job.data.orgName,
                    scraperSupervisorReject
                );

                return await onReceiveScraperJobMessage(
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

module.exports = function (job: Bull.Job<ScraperJobRequestData>) {
    console.log(
        `scraper job ${job.id} started processing, with params`,
        job.data
    );

    const redisClientSubscription = Redis.createClient(redisManager.config);
    const redisClientPublish = redisClientSubscription.duplicate();
    const redisPubsubChannelName = `${
        RedisPubSubChannelName.SCRAPER_JOB_CHANNEL
    }:${job.data.orgInfo || job.data.orgName}:${
        job.data.lastProgress ? job.data.lastProgress.processedSession : 0
    }`;

    return superviseScraper(
        job,
        redisPubsubChannelName,
        redisClientSubscription,
        redisClientPublish
    )
        .then(resultMessage => {
            cleanupRedisSubscriptionConnection(
                redisPubsubChannelName,
                redisClientSubscription,
                redisClientPublish,
                job.data.orgInfo || job.data.orgName
            );
            return resultMessage;
        })
        .catch(error => {
            cleanupRedisSubscriptionConnection(
                redisPubsubChannelName,
                redisClientSubscription,
                redisClientPublish,
                job.data.orgInfo || job.data.orgName
            );
            return Promise.reject(error);
        });
};
