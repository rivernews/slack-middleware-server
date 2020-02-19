import express from 'express';
import * as controllers from './controllers';

export const qualitativeOrgReviewRouter = express.Router();

// sub route base
export const baseUrl = '/qualitative-org-review';

// endpoints
export const listOrgsEndpoint = '/list-org';
export const slackToTravisCIEndpoint = '/slack-to-travisci';
// add more endpoints of controllers...

// register controllers
qualitativeOrgReviewRouter.post(
    listOrgsEndpoint,
    controllers.listOrgsController
);
qualitativeOrgReviewRouter.post(
    slackToTravisCIEndpoint,
    controllers.slackToTravisCIController
);
// add more routes (endpoint - controller pairs)...
