import { s3OrgsJobQueueManager } from './s3OrgsJob/queue';
import {
    asyncSendSlackMessage,
    parseArgsFromSlackForLaunch
} from '../services/slack';
import { Request, Response, NextFunction } from 'express';
import { supervisorJobQueueManager } from './supervisorJob/queue';
import {
    ParameterRequirementNotMet,
    ServerError
} from '../utilities/serverExceptions';
import {
    JobQueueName,
    getProssesorName
} from '../services/jobQueue/jobQueueName';
import { RuntimeEnvironment } from '../utilities/runtime';
import {
    ScraperCrossRequest,
    ScraperJobMessageType,
    ScraperJobMessageTo
} from '../services/jobQueue/types';
import {
    JobQueueSharedRedisClientsSingleton,
    RedisPubSubChannelName
} from '../services/redis';
import { composePubsubMessage } from '../services/jobQueue/message';
import { gdOrgReviewScraperJobQueueManager } from './scraperJob/queue';

export const s3OrgsJobController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (!s3OrgsJobQueueManager.queue) {
        throw new ServerError(
            `s3OrgsJobQueueManager queue not yet initialized`
        );
    }

    try {
        // make sure only one s3 job present at a time
        const jobsPresentCount = await s3OrgsJobQueueManager.checkConcurrency(
            1
        );

        console.debug(
            `s3OrgsJobController: existing s3 job count ${jobsPresentCount}, ready to dispatch job`
        );

        const s3OrgsJob = await s3OrgsJobQueueManager.asyncAdd(null);

        await asyncSendSlackMessage(
            `added ${
                JobQueueName.GD_ORG_REVIEW_S3_ORGS_JOB
            } \`\`\`${JSON.stringify(s3OrgsJob)}\`\`\``
        );

        return res.json(s3OrgsJob);
    } catch (error) {
        res.json({
            error
        });
    }
};

export const singleOrgJobController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    let companyInformationString;

    try {
        companyInformationString = parseArgsFromSlackForLaunch(req);
        if (!companyInformationString) {
            console.log('No company included');
            throw new ParameterRequirementNotMet(
                'No company specified, will do nothing'
            );
        }

        console.log(`Company info string is ${companyInformationString}`);

        console.log('Ready to dispatch supervisorJob');
        const supervisorJob = await supervisorJobQueueManager.asyncAdd({
            orgInfo: companyInformationString
        });

        console.log('dispatch result:\n', supervisorJob);

        // slack log the trigger response
        const slackRes = await asyncSendSlackMessage(
            'Dispatch supervisorJob success. Below is the job added:\n```' +
                JSON.stringify(supervisorJob, null, 2) +
                '```'
        );
        process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT &&
            console.debug('Slack res', slackRes.status);

        return res.json(supervisorJob);
    } catch (error) {
        console.error(
            'Single org job endpoint controller error:',
            error.message
        );
        return next(error);
    }
};

export const singleOrgRenewalJobController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (!supervisorJobQueueManager.queue) {
        throw new ServerError(
            `supervisorJobQueueManager queue not yet initialized`
        );
    }

    console.log('req.body', req.body);
    // it's frontend's responsibility to ensure the data shape is correct
    // and compliance to required fields in cross request data

    let supervisorJob;
    if (
        typeof req.body.orgInfo === 'string' &&
        req.body.orgInfo.trim() !== ''
    ) {
        supervisorJob = await supervisorJobQueueManager.asyncAdd({
            orgInfo: (req.body.orgInfo as string).trim()
        });
    } else if (ScraperCrossRequest.isScraperCrossRequestData(req.body, true)) {
        supervisorJob = await supervisorJobQueueManager.asyncAdd({
            crossRequestData: req.body
        });
    } else {
        const responseMessage = 'Missing request data or invalid data shape';
        console.warn(responseMessage);
        return res.json({
            responseMessage
        });
    }

    if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
        console.log(
            'In development environment, skipping slack message sending'
        );
    } else if (process.env.NODE_ENV === RuntimeEnvironment.PRODUCTION) {
        const slackRes = await asyncSendSlackMessage(
            'Dispatch supervisorJob success. Below is the job added (note: actual orgName sent to Travis will be patched with double quote):\n```' +
                JSON.stringify(
                    {
                        id: supervisorJob.id,
                        data: supervisorJob.data,
                        name: supervisorJob.name
                    },
                    null,
                    2
                ) +
                '```'
        );
        console.log(
            'sent slack message, slack API res status',
            slackRes.status
        );
    }

    res.json(supervisorJob);
};

export const terminateAllJobsController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.debug('terminate job controller');

    JobQueueSharedRedisClientsSingleton.singleton.intialize(
        'master process: terminate controller'
    );
    if (!JobQueueSharedRedisClientsSingleton.singleton.genericClient) {
        return next(new ServerError(`Shared redis client did not initialize`));
    }

    // best efforts to clear waiting job as well
    if (supervisorJobQueueManager.queue) {
        await supervisorJobQueueManager.queue.empty();
    }

    const publishedResult = await JobQueueSharedRedisClientsSingleton.singleton.genericClient.publish(
        RedisPubSubChannelName.ADMIN,
        composePubsubMessage(
            ScraperJobMessageType.TERMINATE,
            ScraperJobMessageTo.ALL,
            {
                triggeredBy: 'terminateAllJobsEndpoint'
            }
        )
    );

    res.json({
        publishedResult
    });

    return;
};

export const resumeAllQueuesController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.debug('resume all queues controller');

    for (const queue of [
        s3OrgsJobQueueManager.queue,
        supervisorJobQueueManager.queue,
        gdOrgReviewScraperJobQueueManager.queue
    ]) {
        if (queue) {
            try {
                await queue.resume();
            } catch (error) {
                console.warn(`failed to resume queue ${queue.name}`, error);
            }
        }
    }

    return res.json({
        message: 'OK!'
    });
};

export const pauseAllQueuesController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.debug('pause all queues controller');

    for (const queue of [
        s3OrgsJobQueueManager.queue,
        supervisorJobQueueManager.queue,
        gdOrgReviewScraperJobQueueManager.queue
    ]) {
        if (queue) {
            try {
                await queue.pause();
            } catch (error) {
                console.warn(`failed to pause queue ${queue.name}`, error);
            }
        }
    }

    return res.json({
        message: 'OK!'
    });
};
