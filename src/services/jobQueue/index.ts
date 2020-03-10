import { supervisorJobQueueManager } from '../../JobQueueAPI/supervisorJob/queue';
import { setQueues } from 'bull-board';
import { gdOrgReviewScraperJobQueueManager } from '../../JobQueueAPI/scraperJob/queue';
import { redisManager, JobQueueSharedRedisClientsSingleton } from '../redis';
import { s3OrgsJobQueueManager } from '../../JobQueueAPI/s3OrgsJob/queue';
import { RuntimeEnvironment } from '../../utilities/runtime';
import { ServerError } from '../../utilities/serverExceptions';

// Constants

// Depends on travis job setup time. Usually, till scraper launched & publish request ack is around 1 min 15 sec after travis build scheduled.
// However, there's a record this took longer than 4 minutes: https://travis-ci.com/rivernews/review-scraper-java-development-environment/builds/152118738
// hence we are raising the timeout even more, see defaults below.
// you can also set this via environment variable
export const TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS = process.env
    .TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS
    ? parseInt(process.env.TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS)
    : process.env.NODE_ENV === RuntimeEnvironment.PRODUCTION
    ? // default to 10 minutes in production
      10 * 60 * 1000
    : // default to 3 minutes in development so in case of memory leak the job can be timed out faster
      3 * 60 * 1000;

const initializeJobQueues = () => {
    gdOrgReviewScraperJobQueueManager.initialize('master');
    supervisorJobQueueManager.initialize('master');
    s3OrgsJobQueueManager.initialize('master');
};

const registerJobQueuesToDashboard = () => {
    if (
        !(
            supervisorJobQueueManager.queue &&
            gdOrgReviewScraperJobQueueManager.queue &&
            s3OrgsJobQueueManager.queue
        )
    ) {
        throw new ServerError(
            `Failed to register job queues to dashboard, at least one of the queues is not initialized`
        );
    }

    const jobUISetQueuesQueueNames = Object.keys(
        // bull-board repo & doc
        // https://github.com/vcapretz/bull-board
        setQueues([
            supervisorJobQueueManager.queue,
            gdOrgReviewScraperJobQueueManager.queue,
            s3OrgsJobQueueManager.queue
        ])
    );
    console.log(
        'registered job queues to job UI dashboard',
        jobUISetQueuesQueueNames
    );
};

export const startJobQueues = () => {
    if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
        JobQueueSharedRedisClientsSingleton.singleton.intialize(
            'master:startJobQueues'
        );
        if (!JobQueueSharedRedisClientsSingleton.singleton.genericClient) {
            throw new ServerError(
                `master: Shared redis client did not initialize`
            );
        }

        JobQueueSharedRedisClientsSingleton.singleton.genericClient.flushdb(
            error => {
                if (error) {
                    console.error('failed to flush db', error);
                } else {
                    console.debug(`flushed redis db ${redisManager.config.db}`);

                    initializeJobQueues();
                    registerJobQueuesToDashboard();
                }
            }
        );
    } else {
        initializeJobQueues();
        registerJobQueuesToDashboard();
    }
};

export const asyncCleanupJobQueuesAndRedisClients = async ({
    processName
}: {
    processName: string;
}) => {
    // Queue.close
    // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueclose
    try {
        await supervisorJobQueueManager.asyncCleanUp();
    } catch (error) {
        console.warn(
            `In ${processName} process: supervisorJobQueueManager queue fail to close`,
            error
        );
    }
    try {
        await gdOrgReviewScraperJobQueueManager.asyncCleanUp();
    } catch (error) {
        console.warn(
            `In ${processName} process: gdOrgReviewScraperJobQueueManager queue fail to close`,
            error
        );
    }
    try {
        await s3OrgsJobQueueManager.asyncCleanUp();
    } catch (error) {
        console.warn(
            `In ${processName} process: s3OrgsJobQueueManager queue fail to close`,
            error
        );
    }

    // Add more queue clean up here ...

    console.log(`In ${processName} process: all job queues closed`);

    // TODO: manually closing redis client created by Bull, which use ioredis,
    // will cause memory consumption surge due to ioredis keep trying to reconnect
    // Use this with caution, or remove it in the future
    // last check for all redis connection closed
    await redisManager.asyncCloseAllClients();

    return;
};
