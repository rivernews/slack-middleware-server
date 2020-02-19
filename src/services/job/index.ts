import Bull = require('bull');
import { redisConnectionConfig } from '../redis';

export enum CronjobQueueName {
    GD_ORG_REVIEW_RENEWAL = 'gdOrgReviewRenewalCronjob'
}

// Bull website quick guide
// https://optimalbits.github.io/bull/

// Quick guide creating queue
// https://github.com/OptimalBits/bull#quick-guide
export const gdOrgReviewRenewalCronjobQueue = new Bull(
    CronjobQueueName.GD_ORG_REVIEW_RENEWAL,
    {
        redis: redisConnectionConfig,
        defaultJobOptions: {
            repeat: {
                // cron expression descriptor
                // https://cronexpressiondescriptor.azurewebsites.net/
                cron: '* * * * 0'
            }
        }
    }
);

// API
// https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#events
