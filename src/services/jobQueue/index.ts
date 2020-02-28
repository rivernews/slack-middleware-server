import { supervisorJobQueue } from '../../GdOrgReviewRenewal/supervisorJob/queue';
import { setQueues } from 'bull-board';
import { gdOrgReviewScraperJobQueue } from '../../GdOrgReviewRenewal/scraperJob/queue';
import { createClient } from 'redis';
import { redisManager } from '../redis';

export const startJobQueues = () => {
    // TODO: add a if block once we add feature of resuming failed cronjob
    // process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT
    const redisAdminClient = createClient(redisManager.config);
    redisAdminClient.flushdb();
    console.debug(`flushed redis db ${redisManager.config.db}`);
    redisAdminClient.quit();

    // register job queues
    supervisorJobQueue.empty();
    // TODO: remove this since we exposed an endpoint for manual cronjob
    // .then(() => gdOrgReviewRenewalCronjobQueue.add({}))
    // .then(gdOrgReviewRenewalCronjob => {
    //     console.log('registered cronjob', gdOrgReviewRenewalCronjob.id);
    // })

    // register queues to dashboard
    const jobUISetQueuesQueueNames = Object.keys(
        // bull-board repo & doc
        // https://github.com/vcapretz/bull-board
        setQueues([supervisorJobQueue, gdOrgReviewScraperJobQueue])
    );
    console.log(
        'registered job queues to job UI dashboard',
        jobUISetQueuesQueueNames
    );
};

export const cleanupJobQueues = async () => {
    // Queue.empty to delete all existing jobs
    //github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueempty
    await supervisorJobQueue.empty();
    console.log('cronjob queue cleaned to empty');
    await gdOrgReviewScraperJobQueue.empty();
    console.log('scraper job queue cleaned to empty');

    // Queue.close
    // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueclose
    await supervisorJobQueue.close();
    await gdOrgReviewScraperJobQueue.close();
    console.log('all job queues closed');

    // Add more clean up here ...

    return;
};
