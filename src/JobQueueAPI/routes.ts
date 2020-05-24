import express from 'express';
import {
    s3OrgsJobController,
    singleOrgJobController,
    singleOrgRenewalJobController,
    terminateAllJobsController,
    resumeAllQueuesController,
    pauseAllQueuesController
} from './controllers';
import { RuntimeEnvironment } from '../utilities/runtime';
import { corsConfig } from '../utilities/authenticators';

export const gdOrgReviewRenewalRouter = express.Router();

// sub route base
export const gdOrgReviewRenewalBaseUrl = '/queues';

// endpoints
export const s3OrgsJobEndpoint = '/s3-orgs-job';
export const singleOrgJobEndpoint = '/single-org-job';
export const singleOrgRenewalJobEndpoint = '/single-org-renewal-job';
export const terminateAllJobsEndpoint = '/terminate-all-jobs';
export const resumeAllQueuesEndpoint = '/resume-all-queues';
export const pauseAllQueuesEndpoint = '/pause-all-queues';
// add more endpoints of controllers...

// register controllers
gdOrgReviewRenewalRouter.use(corsConfig);
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
gdOrgReviewRenewalRouter.post(
    resumeAllQueuesEndpoint,
    resumeAllQueuesController
);
gdOrgReviewRenewalRouter.post(pauseAllQueuesEndpoint, pauseAllQueuesController);
// add more routes (endpoint - controller pairs)...
