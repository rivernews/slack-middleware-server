import { setQueues } from 'bull-board';
import { gdOrgReviewRenewalCronjobQueue } from '.';

// bull-board repo & doc
// https://github.com/vcapretz/bull-board
export const jobUISetQueuesQueueNames = Object.keys(
    setQueues([gdOrgReviewRenewalCronjobQueue])
);
