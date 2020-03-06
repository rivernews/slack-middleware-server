import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import { SupervisorJobRequestData } from '../../services/jobQueue/types';
import { JobQueueManager } from '../../services/jobQueue/QueueManager';

export const supervisorJobQueueManager = new JobQueueManager<
    SupervisorJobRequestData
>({
    __processDirname: __dirname,
    relativePathWithoutExtension: './process',
    queueName: JobQueueName.GD_ORG_REVIEW_SUPERVISOR_JOB,
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
    }
});
