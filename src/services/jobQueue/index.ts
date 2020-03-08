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

export const SUPERVISOR_JOB_CONCURRENCY = process.env.SUPERVISOR_JOB_CONCURRENCY
    ? parseInt(process.env.SUPERVISOR_JOB_CONCURRENCY)
    : 4;

const initializeJobQueues = () => {
    gdOrgReviewScraperJobQueueManager.initialize();
    supervisorJobQueueManager.initialize();
    s3OrgsJobQueueManager.initialize();
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
        JobQueueSharedRedisClientsSingleton.singleton.intialize();
        if (!JobQueueSharedRedisClientsSingleton.singleton.genericClient) {
            throw new ServerError(`Shared redis client did not initialize`);
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

export const cleanupJobQueuesAndRedisClients = async () => {
    // Queue.close
    // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueclose
    try {
        supervisorJobQueueManager.queue &&
            (await supervisorJobQueueManager.queue.close());
    } catch (error) {
        console.warn('supervisorJobQueueManager queue fail to close', error);
    }
    try {
        gdOrgReviewScraperJobQueueManager.queue &&
            (await gdOrgReviewScraperJobQueueManager.queue.close());
    } catch (error) {
        console.warn(
            'gdOrgReviewScraperJobQueueManager queue fail to close',
            error
        );
    }
    try {
        s3OrgsJobQueueManager.queue &&
            (await s3OrgsJobQueueManager.queue.close());
    } catch (error) {
        console.warn('s3OrgsJobQueueManager queue fail to close', error);
    }

    // Add more queue clean up here ...

    console.log('all job queues closed');

    // last check for all redis connection closed
    await redisManager.asyncCloseAllClients();

    return;
};
