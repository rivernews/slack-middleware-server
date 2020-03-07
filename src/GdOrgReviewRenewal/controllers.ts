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
import { JobQueueName } from '../services/jobQueue/jobQueueName';
import { RuntimeEnvironment } from '../utilities/runtime';
import { ScraperCrossRequest } from '../services/jobQueue/types';

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

        const s3OrgsJob = await s3OrgsJobQueueManager.queue.add(null);

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
        if (!supervisorJobQueueManager.queue) {
            throw new ServerError(
                `supervisorJobQueueManager queue not yet initialized`
            );
        }
        const supervisorJob = await supervisorJobQueueManager.queue.add({
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
            console.debug('Slack res', slackRes);

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
    if (typeof req.body.orgInfo === 'string') {
        supervisorJob = await supervisorJobQueueManager.queue.add({
            orgInfo: (req.body.orgInfo as string).trim()
        });
    } else if (ScraperCrossRequest.isScraperCrossRequestData(req.body, true)) {
        supervisorJob = await supervisorJobQueueManager.queue.add({
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
