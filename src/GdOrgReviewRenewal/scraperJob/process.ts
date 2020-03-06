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
import { RuntimeEnvironment } from '../../utilities/runtime';
import { ProgressBarManager } from '../../services/jobQueue/ProgressBar';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS } from '../../services/jobQueue';

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

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
    redisClientPublish: Redis.RedisClient,
    scraperSupervisorResolve: (value?: string | ScraperCrossRequest) => void,
    scraperSupervisorReject: (reason?: string) => void,
    timeoutTimer: NodeJS.Timer
): Promise<string | ScraperCrossRequest | undefined | void> => {
    console.log(`job ${jobId} received message from channel`, channel);

    const [type, messageTo, ...payload] = message.split(':');
    const payloadAsString = payload.join(':');

    if (messageTo !== ScraperJobMessageTo.SLACK_MD_SVC) {
        console.debug(
            `job ${jobId} ignoring messages that are not for us`,
            message
        );
        return;
    }

    if (type === ScraperJobMessageType.PREFLIGHT) {
        console.log(`job ${jobId}`, 'preflight received', payload);
        if (
            !redisClientPublish.publish(
                channel,
                `${ScraperJobMessageType.PREFLIGHT}:${ScraperJobMessageTo.SCRAPER}:acknowledged`
            )
        ) {
            return abortSubscription(
                `job ${jobId} fail to respond to preflight message`,
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
        console.log(`job ${jobId} progress reported`, progressData);

        await jobProgressBar.setRelativePercentage(
            progressData.wentThrough,
            progressData.total
        );

        return;
    } else if (type === ScraperJobMessageType.FINISH) {
        clearTimeout(timeoutTimer);
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
        return abortSubscription(
            `job ${jobId} scraper job reported error`,
            payloadAsString,
            timeoutTimer,
            scraperSupervisorReject
        );
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
    jobId: string,
    org: string = 'null',
    redisPubsubChannelName: string,
    scraperSupervisorReject: (reason?: string) => void
) =>
    setTimeout(async () => {
        console.warn(
            `job ${jobId} timed out after ` +
                TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS +
                ' ms'
        );

        await asyncSendSlackMessage(
            `Supervisor job ${jobId} timed out ${TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS}ms while supervising scraper job for org ${org}; pubsub channel is \`${redisPubsubChannelName}\``
        );

        return scraperSupervisorReject(
            `job ${jobId} for org ${org} timed out ${TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS}ms while supervising travis scraper job; pubsub channel is \`${redisPubsubChannelName}\``
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
    redisClientSubscription: Redis.RedisClient,
    redisClientPublish: Redis.RedisClient
) => {
    const progressBar = new ProgressBarManager(
        JobQueueName.GD_ORG_REVIEW_SCRAPER_JOB,
        job,
        job.data.lastProgress ? job.data.lastProgress.total : undefined,
        job.data.lastProgress ? job.data.lastProgress.wentThrough : undefined
    );

    return new Promise<string | ScraperCrossRequest>(
        (scraperSupervisorResolve, scraperSupervisorReject) => {
            let timeoutTimer = getMessageTimeoutTimer(
                job.id.toString(),
                job.data.orgName || job.data.orgInfo,
                redisPubsubChannelName,
                scraperSupervisorReject
            );

            redisClientSubscription.on('subscribe', async () => {
                console.log(
                    `job ${job.id} subscribed to channel ${redisPubsubChannelName}`
                );

                // TODO: avoid the need to have to hard code things that you have to manually change
                // remove this block if want to run scraper on local for debugging
                if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
                    console.log(
                        'in development environment, skipping travis request. Please run scraper locally if needed'
                    );
                    return;
                }

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

                await progressBar.increment();

                const travisJob = triggerTravisJobRequest.data;

                console.log(
                    `job ${job.id} request travis job successfully: ${travisJob.request.id}/${travisJob['@type']}, remaining_requests=${travisJob['remaining_requests']}`
                );
            });

            redisClientSubscription.on('message', async (channel, message) => {
                clearTimeout(timeoutTimer);
                timeoutTimer = getMessageTimeoutTimer(
                    job.id.toString(),
                    job.data.orgName || job.data.orgInfo,
                    redisPubsubChannelName,
                    scraperSupervisorReject
                );

                return await onReceiveScraperJobMessage(
                    job.id.toString(),
                    progressBar,
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

    const patchedJob: Bull.Job<ScraperJobRequestData> = {
        ...job,
        data: patchOrgNameOnScraperJobRequestData(job.data)
    };

    console.log(`scraper job ${patchedJob.id} patched params`, patchedJob.data);

    const redisClientSubscription = redisManager.newClient();
    const redisClientPublish = redisManager.newClient();
    const redisPubsubChannelName = `${
        RedisPubSubChannelName.SCRAPER_JOB_CHANNEL
    }:${patchedJob.data.orgInfo || patchedJob.data.orgName}:${
        patchedJob.data.lastProgress
            ? patchedJob.data.lastProgress.processedSession
            : 0
    }`;

    return superviseScraper(
        patchedJob,
        redisPubsubChannelName,
        redisClientSubscription,
        redisClientPublish
    )
        .then(resultMessage => {
            cleanupRedisSubscriptionConnection(
                redisPubsubChannelName,
                redisClientSubscription,
                redisClientPublish,
                patchedJob.data.orgInfo || patchedJob.data.orgName
            );
            return resultMessage;
        })
        .catch(error => {
            cleanupRedisSubscriptionConnection(
                redisPubsubChannelName,
                redisClientSubscription,
                redisClientPublish,
                patchedJob.data.orgInfo || patchedJob.data.orgName
            );
            return Promise.reject(error);
        });
};
