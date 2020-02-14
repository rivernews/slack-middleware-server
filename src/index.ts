'use strict';

import express from 'express';
import { ErrorResponse } from './utilities/serverUtilities';

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

const nodeServer = app.listen(PORT, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
});

module.exports = nodeServer;
