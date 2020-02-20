'use strict';

import express from 'express';
import { ErrorResponse } from './utilities/serverUtilities';
import { UI } from 'bull-board';
import { jobUISetQueuesQueueNames } from './services/jobQueue/dashboard';
import { gdOrgReviewRenewalCronjobQueue } from './services/jobQueue/gdOrgReviewRenewal/cronjob/queue';
import { createTerminus } from '@godaddy/terminus';

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
    res.send('Hello! This is our slack service.');
});
app.use(
    require('./QualitativeOrgReview/routes').baseUrl,
    require('./QualitativeOrgReview/routes').qualitativeOrgReviewRouter
);
// console.log('registered cronjob', gdOrgReviewRenewalCronjob);
// app.use('/admin/queues', UI);
// console.log(
//     'registered job queues to job UI dashboard',
//     jobUISetQueuesQueueNames
// );

// TODO: explore travisCI API
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
});

// Clean up server resources & any external connections

const cleanUpExpressServer = async () => {
    console.log('cleaning up...');
    // Queue.close
    // https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueclose
    await gdOrgReviewRenewalCronjobQueue.close();
    console.log('cronjob queue closed');

    // Add more clean up here ...

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
