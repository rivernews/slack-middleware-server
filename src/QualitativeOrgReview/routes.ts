import express from 'express';
import * as controllers from './controllers';

export const qualitativeOrgReviewRouter = express.Router();

// sub route base
export const qualitativeOrgReviewBaseUrl = '/qualitative-org-review';

// endpoints
export const listOrgsEndpoint = '/list-org';
// add more endpoints of controllers...

// register controllers
qualitativeOrgReviewRouter.post(
    listOrgsEndpoint,
    controllers.listOrgsController
);
// add more routes (endpoint - controller pairs)...
