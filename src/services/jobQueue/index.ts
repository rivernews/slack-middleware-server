import { supervisorJobQueueManager } from '../../GdOrgReviewRenewal/supervisorJob/queue';
import { setQueues } from 'bull-board';
import { gdOrgReviewScraperJobQueueManager } from '../../GdOrgReviewRenewal/scraperJob/queue';
import { createClient } from 'redis';
import { redisManager } from '../redis';
import { s3OrgsJobQueueManager } from '../../GdOrgReviewRenewal/s3OrgsJob/queue';
import { RuntimeEnvironment } from '../../utilities/runtime';

export const SUPERVISOR_JOB_CONCURRENCY = 4;

export const startJobQueues = () => {
    // TODO: add a if block once we add feature of resuming failed cronjob
    if (process.env.NODE_ENV !== RuntimeEnvironment.PRODUCTION) {
        const redisAdminClient = createClient(redisManager.config);
        redisAdminClient.flushdb();
        console.debug(`flushed redis db ${redisManager.config.db}`);
        redisAdminClient.quit();
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
    await supervisorJobQueueManager.queue.close();
    await gdOrgReviewScraperJobQueueManager.queue.close();
    await s3OrgsJobQueueManager.queue.close();
    console.log('all job queues closed');

    // Add more clean up here ...

    return;
};
