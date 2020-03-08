import { JobQueueManager } from '../../services/jobQueue/JobQueueManager';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';

export const s3OrgsJobQueueManager = new JobQueueManager<null>({
    __processDirname: __dirname,
    relativePathWithoutExtension: './process',
    queueName: JobQueueName.GD_ORG_REVIEW_S3_ORGS_JOB,
    concurrency: 1
});
