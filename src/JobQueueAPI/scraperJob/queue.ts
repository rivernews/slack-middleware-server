import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { ScraperJobRequestData } from '../../services/jobQueue/types';
import { JobQueueManager } from '../../services/jobQueue/JobQueueManager';
import { Configuration } from '../../utilities/configuration';

export const gdOrgReviewScraperJobQueueManager = new JobQueueManager<
    ScraperJobRequestData
>({
    __processDirname: __dirname,
    relativePathWithoutExtension: './process',
    queueName: JobQueueName.GD_ORG_REVIEW_SCRAPER_JOB,
    defaultJobOptions: {
        // K8 api server may throw the error below when too busy:
        // IOException while requesting POST - java.io.IOException: /10.244.0.57:41546: GOAWAY received
        // so we retry again - best effort to complete the job
        //
        // TODO: increasing attempts will conflict with our "terminate" feature
        // unless we resolve terminated jobs instead of reject
        // attempts: process.env.NODE_ENV === RuntimeEnvironment.PRODUCTION ? 2 : 1
        // we should already solve manual termination issue by succeed terminated scraper job (but fail supervisor job)
        attempts: 3

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

    jobConcurrency: Math.floor(
        Configuration.singleton.localMaximumScraperCapacity
    )
});
