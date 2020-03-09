'use strict';

import express from 'express';
import { ErrorResponse } from './utilities/serverExceptions';
import { createTerminus } from '@godaddy/terminus';
import {
    startJobQueues,
    asyncCleanupJobQueuesAndRedisClients
} from './services/jobQueue';
import {
    RuntimeEnvironment,
    RUNTIME_CI_ENVIRONMENT
} from './utilities/runtime';
import {
    qualitativeOrgReviewBaseUrl,
    qualitativeOrgReviewRouter
} from './QualitativeOrgReview/routes';
import {
    slackAuthenticateMiddleware,
    jobQueueAuthenticateMiddleware,
    jobQueueDashboardAuthenticateMiddleware
} from './utilities/authenticators';
import {
    gdOrgReviewRenewalBaseUrl,
    gdOrgReviewRenewalRouter
} from './JobQueueAPI/routes';
import { UI } from 'bull-board';
import { redisManager } from './services/redis';

// Constants
if (!process.env.PORT) {
    throw 'PORT not specified';
}
const PORT = parseInt(process.env.PORT);
const HOST = process.env.HOST;

// App

const app: express.Application = express();

// App Config
app.use(express.json());
app.use(
    express.urlencoded({
        extended: true
    })
);

// App Routes

app.get('/', async (req, res) => {
    res.send(
        'Hello! This is our slack service. <a href="/dashboard">Queue Dashboard</a> (credential required)<br>' +
            'Visit the <a target="_blank" href="https://slack.shaungc.com">frontend website</a>.'
    );
});
app.use(
    qualitativeOrgReviewBaseUrl,
    slackAuthenticateMiddleware,
    qualitativeOrgReviewRouter
);
// test single job: curl -v -X POST http://localhost:8080/queues/single-org-job\?token\=REl9oGZ-RLVWU7eK8ZVloQ
// test s3 orgs job: curl -v -X POST http://localhost:8080/queues/s3-orgs-job\?token\=REl9oGZ-RLVWU7eK8ZVloQ
app.use(
    gdOrgReviewRenewalBaseUrl,
    jobQueueAuthenticateMiddleware,
    gdOrgReviewRenewalRouter
);
app.use('/dashboard', jobQueueDashboardAuthenticateMiddleware, UI);

// TravisCI API
// https://developer.travis-ci.com/resource/requests#Requests

// error handling, has to be the last middleware
// https://expressjs.com/en/guide/error-handling.html
app.use(
    (
        err: ErrorResponse,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        // if it is indeed an ErrorResponse object
        if (err.status && err.message) {
            res.status(err.status).json({
                message: err.message,
                status: err.status
            });
        } else {
            next(err);
        }
    }
);

// Bootstrap server

const expressServer = app.listen(PORT, () => {
    console.log(`Running on http://${HOST}:${PORT}`);

    RUNTIME_CI_ENVIRONMENT != RuntimeEnvironment.TESTING && startJobQueues();
});

// Clean up server resources & any external connections

export const cleanUpExpressServer = async () => {
    console.log('cleaning up...');

    RUNTIME_CI_ENVIRONMENT != RuntimeEnvironment.TESTING &&
        (await asyncCleanupJobQueuesAndRedisClients());

    return;
};

// Handling server exiting

// dealing with killing server by CTRL+C or system signals
// npm test will also signal too so will duplicate with the on('close') handler;
// but having onSignal here to provide an extra layer of
// guarantee for other system-wise exit requests
const onSignal = async () => {
    console.log('on signal: SIGINT | SIGTERM | SIGHUP...');
    await cleanUpExpressServer();
    console.log('=== onSignal: clean up complete ===');
    return;
};

// Terminus
// https://github.com/godaddy/terminus
// Express doc on Terminus
// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
export const gracefulExpressServer = createTerminus(expressServer, {
    signals: ['SIGINT', 'SIGTERM', 'SIGHUP'],
    onSignal,

    // for kubernetes
    // https://github.com/godaddy/terminus#how-to-set-terminus-up-with-kubernetes
    beforeShutdown: () =>
        new Promise(resolve => {
            setTimeout(resolve, 5000);
        })
});

// TODO: evaluate if we do not need this
// see if you remove `--exit` in `npm test` command, can the server terminate successfully?
// dealing with programmatic exit (e.g. from npm test)
// gracefulExpressServer.on('close', async () => {
//     console.log('closing...');
//     await cleanUpExpressServer();
//     console.log('=== close: clean up complete ===');
//     return;
// });
