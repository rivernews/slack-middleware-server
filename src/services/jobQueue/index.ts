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
