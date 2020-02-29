import { s3OrgsJobQueueManager } from './s3OrgsJob/queue';
import {
    asyncSendSlackMessage,
    parseArgsFromSlackForLaunch
} from '../services/slack';
import { Request, Response, NextFunction } from 'express';
import { supervisorJobQueue } from './supervisorJob/queue';
import { ParameterRequirementNotMet } from '../utilities/serverExceptions';

export const s3OrgsJobController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.debug('s3OrgsJobController: ready to dispatch job');
    const s3OrgsJob = await s3OrgsJobQueueManager.queue.add(null);
    await asyncSendSlackMessage(JSON.stringify(s3OrgsJob));
    return res.json(s3OrgsJob);
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

        // TODO: change this to dispatch supervisor job
        console.log('Ready to dispatch supervisorJob');
        // const triggerRes = await travis.asyncTriggerQualitativeReviewRepoBuild({
        //     orgInfo: companyInformationString
        // });
        const supervisorJob = await supervisorJobQueue.add(
            companyInformationString
        );

        // if (triggerRes.status >= 400) {
        //     console.log('travis return abnormal response');
        //     console.log(triggerRes.data);
        //     return res
        //         .json({
        //             message: 'Travis returned abnormal response',
        //             travisStatus: triggerRes.status,
        //             travisResponse: triggerRes.data
        //         })
        //         .status(triggerRes.status);
        // }

        console.log('dispatch result:\n', supervisorJob);

        // slack log the trigger response
        // const travisTriggerSummary = {
        //     remaining_requests: triggerRes.data.remaining_requests,
        //     scraper_branch: triggerRes.data.request.branch,
        //     config: triggerRes.data.request.config
        // };
        const slackRes = await asyncSendSlackMessage(
            'Dispatch supervisorJob success. Below is the job added:\n```' +
                JSON.stringify(supervisorJob, null, 2) +
                '```'
        );
        console.log('Slack res', slackRes);

        return res.json(supervisorJob);
    } catch (error) {
        console.error(
            'Single org job endpoint controller error:',
            error.message
        );
        return next(error);
    }
};
