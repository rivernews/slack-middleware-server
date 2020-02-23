import { gdOrgReviewRenewalCronjobQueue } from './gdOrgReviewRenewal/cronjob/queue';
import { setQueues } from 'bull-board';
import { gdOrgReviewScraperJobQueue } from './gdOrgReviewRenewal/scraperJob/queue';

export const startJobQueues = () => {
    // register job queues
    gdOrgReviewRenewalCronjobQueue
        .empty()
        .then(() => gdOrgReviewRenewalCronjobQueue.add({}))
        .then(gdOrgReviewRenewalCronjob => {
            console.log('registered cronjob', gdOrgReviewRenewalCronjob.id);
        });

    // register queues to dashboard
    const jobUISetQueuesQueueNames = Object.keys(
        // bull-board repo & doc
        // https://github.com/vcapretz/bull-board
        setQueues([gdOrgReviewRenewalCronjobQueue, gdOrgReviewScraperJobQueue])
    );
    console.log(
        'registered job queues to job UI dashboard',
        jobUISetQueuesQueueNames
    );
};

export const cleanupJobQueues = async () => {
    // Queue.empty to delete all existing jobs
    //github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueempty
    https: await gdOrgReviewRenewalCronjobQueue.empty();
    console.log('cronjob queue cleaned to empty');

    // Queue.close
    // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueclose
    await gdOrgReviewRenewalCronjobQueue.close();
    await gdOrgReviewScraperJobQueue.close();
    console.log('all job queues closed');

    // Add more clean up here ...

    return;
};
