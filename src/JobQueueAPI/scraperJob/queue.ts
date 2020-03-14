import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { ScraperJobRequestData } from '../../services/jobQueue/types';
import { JobQueueManager } from '../../services/jobQueue/JobQueueManager';
import { SCRAPER_JOB_POOL_MAX_CONCURRENCY } from '../../services/jobQueue/JobQueueManager';

export const gdOrgReviewScraperJobQueueManager = new JobQueueManager<
    ScraperJobRequestData
>({
    __processDirname: __dirname,
    relativePathWithoutExtension: './process',
    queueName: JobQueueName.GD_ORG_REVIEW_SCRAPER_JOB,
    defaultJobOptions: {
        // TODO: enable repeat opt when in prod
        // repeat: {
        //     // cron expression descriptor
        //     // https://cronexpressiondescriptor.azurewebsites.net/
        //     // cron: '* * * * *',
        //     // other options
        //     // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueadd
        //     every: 60 * (60 * 1000)
        // }
    },
    concurrency: 1
});
