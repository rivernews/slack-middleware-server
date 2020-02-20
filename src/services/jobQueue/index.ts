import Bull = require('bull');
import { redisConnectionConfig } from '../redis';

export enum JobQueueName {
    GD_ORG_REVIEW_RENEWAL_CRONJOB = 'gdOrgReviewRenewalCronjob',
    GD_ORG_REVIEW_SCRAPER_JOB = 'gdOrgReviewScraperJob'
}
