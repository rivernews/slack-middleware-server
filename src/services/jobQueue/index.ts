import { supervisorJobQueueManager } from '../../JobQueueAPI/supervisorJob/queue';
import { setQueues } from 'bull-board';
import { gdOrgReviewScraperJobQueueManager } from '../../JobQueueAPI/scraperJob/queue';
import { redisManager, JobQueueSharedRedisClientsSingleton } from '../redis';
import { s3OrgsJobQueueManager } from '../../JobQueueAPI/s3OrgsJob/queue';
import { RuntimeEnvironment } from '../../utilities/runtime';
import { ServerError } from '../../utilities/serverExceptions';

const initializeJobQueues = () => {
    gdOrgReviewScraperJobQueueManager.initialize('master', true);
    supervisorJobQueueManager.initialize('master', true);
    s3OrgsJobQueueManager.initialize('master', true);
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
    JobQueueSharedRedisClientsSingleton.singleton.intialize('master');

    if (
        process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT ||
        process.env.FLUSHDB_ON_START === 'true'
    ) {
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

    return;
};
