import express from 'express';
import {
    s3OrgsJobController,
    singleOrgJobController,
    singleOrgRenewalJobController
} from './controllers';

export const gdOrgReviewRenewalRouter = express.Router();

// sub route base
export const gdOrgReviewRenewalBaseUrl = '/queues';

// endpoints
export const s3OrgsJobEndpoint = '/s3-orgs-job';
export const singleOrgJobEndpoint = '/single-org-job';
export const singleOrgRenewalJobEndpoint = '/single-org-renewal-job';
// add more endpoints of controllers...

// register controllers
gdOrgReviewRenewalRouter.post(s3OrgsJobEndpoint, s3OrgsJobController);
gdOrgReviewRenewalRouter.post(singleOrgJobEndpoint, singleOrgJobController);
gdOrgReviewRenewalRouter.post(
    singleOrgRenewalJobEndpoint,
    singleOrgRenewalJobController
);
// add more routes (endpoint - controller pairs)...
