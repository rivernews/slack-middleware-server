'use strict';

import express from 'express';
import {
    ErrorResponse,
    NotAuthenticatedResponse
} from './utilities/serverExceptions';
import { UI } from 'bull-board';
import { createTerminus } from '@godaddy/terminus';
import { startJobQueues, cleanupJobQueues } from './services/jobQueue';
import {
    RuntimeEnvironment,
    RUNTIME_CI_ENVIRONMENT
} from './utilities/runtime';
import { supervisorJobQueue } from './GdOrgReviewRenewal/supervisorJob/queue';

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
        'Hello! This is our slack service. <a href="/admin/queues">Queue Dashboard</a>'
    );
});
app.use(
    require('./QualitativeOrgReview/routes').baseUrl,
    require('./QualitativeOrgReview/routes').qualitativeOrgReviewRouter
);
app.post('/queues', async (req, res) => {
    if (
        req.body.token &&
        process.env.TRAVIS_TOKEN &&
        req.body.token === process.env.TRAVIS_TOKEN
    ) {
        console.log('cronjob request received, dispatching...');
        // const cronjob = await supervisorJobQueue.add({});
        // console.log('registered cronjob', cronjob.id);
        // res.json(cronjob);
    } else {
        throw new NotAuthenticatedResponse();
    }
});
app.use('/queues/admin', UI);

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

const cleanUpExpressServer = async () => {
    console.log('cleaning up...');

    await cleanupJobQueues();

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
    console.log('onSignal: clean up complete');
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

// dealing with programmatic exit (e.g. from npm test)
gracefulExpressServer.on('close', async () => {
    console.log('closing...');
    await cleanUpExpressServer();
    console.log('close: clean up complete');
    return;
});
