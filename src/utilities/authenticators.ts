import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { NotAuthenticatedResponse, ServerError } from './serverExceptions';
import { RuntimeEnvironment } from './runtime';

// TODO: needs to secure origin to only production site. cors(): https://expressjs.com/en/resources/middleware/cors.html#installation
export const corsConfig = cors({
    origin:
        process.env.NODE_ENV === RuntimeEnvironment.PRODUCTION
            ? // TODO: use env var to configure this
              `https://slack.shaungc.com`
            : true
});

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

            if (!process.env.SLACK_TOKEN_OUTGOING_LAUNCH) {
                return next(new ServerError(`Misconfigured credential`));
            }

            if (!requesterToken) {
                return next(new NotAuthenticatedResponse());
            }

            if (requesterToken !== process.env.SLACK_TOKEN_OUTGOING_LAUNCH) {
                return next(new NotAuthenticatedResponse());
            }
        }
    }

    return next();
};

export const jobQueueAuthenticateMiddleware = getAuthenticateByTokenMiddleware(
    process.env.SLACK_TOKEN_OUTGOING_LAUNCH
);

export const slackAuthenticateMiddleware = getAuthenticateByTokenMiddleware(
    process.env.SLACK_TOKEN_OUTGOING_LIST_ORG
);
