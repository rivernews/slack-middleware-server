import { setQueues } from 'bull-board';
import { gdOrgReviewRenewalCronjobQueue } from './gdOrgReviewRenewal/cronjob/queue';
import { gdOrgReviewScraperJobQueue } from './gdOrgReviewRenewal/scraperJob/queue';

// bull-board repo & doc
// https://github.com/vcapretz/bull-board
export const jobUISetQueuesQueueNames = Object.keys(
    setQueues([gdOrgReviewRenewalCronjobQueue, gdOrgReviewScraperJobQueue])
);
