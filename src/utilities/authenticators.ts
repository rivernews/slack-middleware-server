import { Request, Response, NextFunction } from 'express';
import { NotAuthenticatedResponse, ServerError } from './serverExceptions';

// factory function to generate auth middleware
export const getAuthenticateByTokenMiddleware = (tokenToVerfy?: string) => {
    if (!tokenToVerfy) {
        throw new ServerError(`authenticator token misconfigured`);
    }

    return (req: Request, res: Response, next: NextFunction) => {
        const requesterToken = req.query.token || req.body.token;

        if (!requesterToken) {
            next(new NotAuthenticatedResponse());
        }

        if (requesterToken !== tokenToVerfy) {
            next(new NotAuthenticatedResponse());
        }

        return next();
    };
};

export const jobQueueAuthenticateMiddleware = getAuthenticateByTokenMiddleware(
    process.env.TRAVIS_TOKEN
);

export const slackAuthenticateMiddleware = getAuthenticateByTokenMiddleware(
    process.env.SLACK_TOKEN_OUTGOING_LIST_ORG
);
