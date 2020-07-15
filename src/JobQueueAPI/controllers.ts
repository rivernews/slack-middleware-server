import { s3OrgsJobQueueManager } from './s3OrgsJob/queue';
import {
    asyncSendSlackMessage,
    parseArgsFromSlackForLaunch
} from '../services/slack';
import { Request, Response, NextFunction } from 'express';
import { supervisorJobQueueManager } from './supervisorJob/queue';
import {
    ParameterRequirementNotMet,
    ServerError,
    getErrorAsString
} from '../utilities/serverExceptions';
import { JobQueueName } from '../services/jobQueue/jobQueueName';
import { RuntimeEnvironment } from '../utilities/runtime';
import {
    ScraperCrossRequest,
    ScraperJobMessageType,
    ScraperJobMessageTo,
    S3JobControllerResponse
} from '../services/jobQueue/types';
import {
    JobQueueSharedRedisClientsSingleton,
    RedisPubSubChannelName
} from '../services/redis';
import {
    composePubsubMessage,
    getPubsubChannelName
} from '../services/jobQueue/message';
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

    let resJson: S3JobControllerResponse = {
        status: 'unknown'
    };

    try {
        if (req.body.singleton) {
            // already finished
            if ((await s3OrgsJobQueueManager.queue.getFailedCount()) > 0) {
                resJson.status = 'failed';
            } else if (
                (await s3OrgsJobQueueManager.queue.getCompletedCount()) > 0
            ) {
                resJson.status = 'completed';
            }
        }

        if (resJson.status === 'unknown') {
            // make sure only one s3 job present at a time
            const jobsPresentCount = await s3OrgsJobQueueManager.checkConcurrency(
                1
            );

            console.debug(
                `s3OrgsJobController: existing s3 job count ${jobsPresentCount}, proceed to dispatch job anyway`
            );

            const s3OrgsJob = await s3OrgsJobQueueManager.asyncAdd(null);

            resJson = {
                ...resJson,
                id: s3OrgsJob.id,
                progress: s3OrgsJob.progress(),
                returnvalue: s3OrgsJob.returnvalue,
                opts: { attempts: s3OrgsJob.opts.attempts },
                status: 'running'
            };
        }
    } catch (dispatchNewS3JobError) {
        const dispatchNewS3JobErrorMessage = getErrorAsString(
            dispatchNewS3JobError
        );
        resJson = { ...resJson, error: dispatchNewS3JobErrorMessage };

        try {
            if ((await s3OrgsJobQueueManager.queue.getActiveCount()) > 0) {
                const s3Jobs = await s3OrgsJobQueueManager.queue.getActive();
                if (s3Jobs.length > 0) {
                    const s3Job = s3Jobs[0];

                    resJson = {
                        ...resJson,
                        status: 'running',
                        jobError: '',
                        progress: await s3Job.progress()
                    };
                }
            } else if (
                (await s3OrgsJobQueueManager.queue.getCompletedCount()) > 0
            ) {
                const s3Jobs = await s3OrgsJobQueueManager.queue.getCompleted();
                if (s3Jobs.length > 0) {
                    const s3Job = s3Jobs[0];

                    resJson = {
                        ...resJson,
                        status: 'completed',
                        jobError: '',
                        progress: await s3Job.progress()
                    };
                }
            } else if (
                (await s3OrgsJobQueueManager.queue.getFailedCount()) > 0
            ) {
                const s3Jobs = await s3OrgsJobQueueManager.queue.getFailed();
                if (s3Jobs.length > 0) {
                    const s3Job = s3Jobs[0];

                    resJson = {
                        ...resJson,
                        status: 'failed',
                        jobError:
                            getErrorAsString(s3Job.returnvalue) ||
                            s3Job.stacktrace.join('\n'),
                        progress: await s3Job.progress()
                    };
                }
            }
        } catch (error) {}
    }

    res.json(resJson);
    return;
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
            scraperJobRequestData: {
                pubsubChannelName: getPubsubChannelName({
                    orgInfo: companyInformationString
                }),
                orgInfo: companyInformationString
            }
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
        const orgInfo = (req.body.orgInfo as string).trim();
        // brand new 1st job
        supervisorJob = await supervisorJobQueueManager.asyncAdd({
            scraperJobRequestData: {
                pubsubChannelName: getPubsubChannelName({ orgInfo }),
                orgInfo
            }
        });
    } else if (ScraperCrossRequest.isScraperCrossRequestData(req.body, true)) {
        // renewal job
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

    JobQueueSharedRedisClientsSingleton.singleton.intialize('master');
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
    console.log('pause all queues controller');

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
