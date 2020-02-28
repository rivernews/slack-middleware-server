import { s3OrgsJobQueueManager } from './s3OrgsJob/queue';
import { asyncSendSlackMessage } from '../services/slack';
import { Request, Response, NextFunction } from 'express';
import { supervisorJobQueue } from './supervisorJob/queue';

enum JobRequestType {
    S3_ORGS_JOB = 's3OrgsJob',
    SINGLE_JOB = 'singleJob'
}

export const s3OrgsJobController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const s3OrgsJob = await s3OrgsJobQueueManager.queue.add(null);
    return await asyncSendSlackMessage(JSON.stringify(s3OrgsJob));
};

// TODO: just reuse travis slack trigger
// or move it to here - even better
// export const singleJobController = async (
//     req: Request,
//     res: Response,
//     next: NextFunction
// ) => {
//     const s3OrgsJob = await supervisorJobQueue.add(null);
//         return await asyncSendSlackMessage(JSON.stringify(s3OrgsJob));
// }
