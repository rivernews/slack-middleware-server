import { supervisorJobQueueManager } from '../../GdOrgReviewRenewal/supervisorJob/queue';
import { setQueues } from 'bull-board';
import { gdOrgReviewScraperJobQueueManager } from '../../GdOrgReviewRenewal/scraperJob/queue';
import { redisManager } from '../redis';
import { s3OrgsJobQueueManager } from '../../GdOrgReviewRenewal/s3OrgsJob/queue';
import { RuntimeEnvironment } from '../../utilities/runtime';

export const SUPERVISOR_JOB_CONCURRENCY = process.env.SUPERVISOR_JOB_CONCURRENCY
    ? parseInt(process.env.SUPERVISOR_JOB_CONCURRENCY)
    : 4;

export const startJobQueues = () => {
    // TODO: add a if block once we add feature of resuming failed cronjob
    if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
        const redisAdminClient = redisManager.newClient();
        redisAdminClient.flushdb();
        console.debug(`flushed redis db ${redisManager.config.db}`);
        // let redisManager close the connection
        // redisAdminClient.quit();
    }

    // register job queues
    // supervisorJobQueue.empty();
    // TODO: remove this since we exposed an endpoint for manual cronjob
    // .then(() => gdOrgReviewRenewalCronjobQueue.add({}))
    // .then(gdOrgReviewRenewalCronjob => {
    //     console.log('registered cronjob', gdOrgReviewRenewalCronjob.id);
    // })

    // register queues to dashboard
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

export const cleanupJobQueues = async () => {
    // Queue.empty to delete all existing jobs
    //github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueempty
    // await supervisorJobQueue.empty();
    // console.log('supervisor job queue cleaned to empty');
    // await gdOrgReviewScraperJobQueue.empty();
    // console.log('scraper job queue cleaned to empty');
    // await s3OrgsJobQueueManager.queue.empty();
    // console.log('s3 orgs job queue cleaned to empty');

    // Queue.close
    // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueclose
    try {
        await supervisorJobQueueManager.queue.pause();
        await supervisorJobQueueManager.queue.close();
    } catch (error) {
        console.warn('supervisorJobQueueManager queue fail to close', error);
    }
    try {
        await gdOrgReviewScraperJobQueueManager.queue.pause();
        await gdOrgReviewScraperJobQueueManager.queue.close();
    } catch (error) {
        console.warn(
            'gdOrgReviewScraperJobQueueManager queue fail to close',
            error
        );
    }
    try {
        await s3OrgsJobQueueManager.queue.pause();
        await s3OrgsJobQueueManager.queue.close();
    } catch (error) {
        console.warn('s3OrgsJobQueueManager queue fail to close', error);
    }

    console.log('all job queues closed');

    // Add more clean up here ...

    return;
};
