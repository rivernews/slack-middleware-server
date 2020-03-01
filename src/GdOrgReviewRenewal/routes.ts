import express from 'express';
import { s3OrgsJobController, singleOrgJobController } from './controllers';

export const gdOrgReviewRenewalRouter = express.Router();

// sub route base
export const gdOrgReviewRenewalBaseUrl = '/queues';

// endpoints
export const s3OrgsJobEndpoint = '/s3-orgs-job';
export const singleOrgJobEndpoint = '/single-org-job';
// add more endpoints of controllers...

// register controllers
gdOrgReviewRenewalRouter.post(s3OrgsJobEndpoint, s3OrgsJobController);
gdOrgReviewRenewalRouter.post(singleOrgJobEndpoint, singleOrgJobController);
// add more routes (endpoint - controller pairs)...
