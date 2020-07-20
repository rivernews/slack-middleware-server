import { JobQueueManager } from '../../services/jobQueue/JobQueueManager';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { S3JobRequestData } from '../../services/jobQueue/types';

export const s3OrgsJobQueueManager = new JobQueueManager<S3JobRequestData>({
    __processDirname: __dirname,
    relativePathWithoutExtension: './process',
    queueName: JobQueueName.GD_ORG_REVIEW_S3_ORGS_JOB,
    jobConcurrency: 1
});
