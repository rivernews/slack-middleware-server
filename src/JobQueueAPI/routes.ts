import express from 'express';
import {
    s3OrgsJobController,
    singleOrgJobController,
    singleOrgRenewalJobController,
    terminateAllJobsController
} from './controllers';
import cors from 'cors';
import { RuntimeEnvironment } from '../utilities/runtime';

export const gdOrgReviewRenewalRouter = express.Router();

// sub route base
export const gdOrgReviewRenewalBaseUrl = '/queues';

// endpoints
export const s3OrgsJobEndpoint = '/s3-orgs-job';
export const singleOrgJobEndpoint = '/single-org-job';
export const singleOrgRenewalJobEndpoint = '/single-org-renewal-job';
export const terminateAllJobsEndpoint = '/terminate-all-jobs';
// add more endpoints of controllers...

// register controllers
gdOrgReviewRenewalRouter.use(
    cors({
        origin:
            process.env.NODE_ENV === RuntimeEnvironment.PRODUCTION
                ? // TODO: use env var to configure this
                  `https://slack.shuangc.com`
                : true
    })
); // TODO: needs to secure origin to only production site. cors(): https://expressjs.com/en/resources/middleware/cors.html#installation
gdOrgReviewRenewalRouter.post(s3OrgsJobEndpoint, s3OrgsJobController);
gdOrgReviewRenewalRouter.post(singleOrgJobEndpoint, singleOrgJobController);
gdOrgReviewRenewalRouter.post(
    singleOrgRenewalJobEndpoint,
    singleOrgRenewalJobController
);
gdOrgReviewRenewalRouter.post(
    terminateAllJobsEndpoint,
    terminateAllJobsController
);
// add more routes (endpoint - controller pairs)...
