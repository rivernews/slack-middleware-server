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
            return next(new NotAuthenticatedResponse());
        }

        if (requesterToken !== tokenToVerfy) {
            return next(new NotAuthenticatedResponse());
        }

        return next();
    };
};

export const jobQueueDashboardAuthenticateMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // only protect route at index page
    // otherwise will block dashboard's internal connection
    if (req.method === 'GET') {
        const [relativePathToRouteBaseWithQuery] = req.url.split('?');
        if (relativePathToRouteBaseWithQuery === '/') {
            const requesterToken = req.query.token || req.body.token;

            if (!process.env.TRAVIS_TOKEN) {
                return next(new ServerError(`Misconfigured credential`));
            }

            if (!requesterToken) {
                return next(new NotAuthenticatedResponse());
            }

            if (requesterToken !== process.env.TRAVIS_TOKEN) {
                return next(new NotAuthenticatedResponse());
            }
        }
    }

    return next();
};

export const jobQueueAuthenticateMiddleware = getAuthenticateByTokenMiddleware(
    process.env.TRAVIS_TOKEN
);

export const slackAuthenticateMiddleware = getAuthenticateByTokenMiddleware(
    process.env.SLACK_TOKEN_OUTGOING_LIST_ORG
);
