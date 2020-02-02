const qualitativeOrgReviewRouter = require('express').Router();

const controllers = require('./controllers');

// sub route base
const baseUrl = '/qualitative-org-review';

// endpoints
const listOrgsEndpoint = '/list-org';
const slackToTravisCIEndpoint = '/slack-to-travisci';
// add more endpoints of controllers...

// register controllers
qualitativeOrgReviewRouter.post(listOrgsEndpoint, controllers.listOrgsController);
qualitativeOrgReviewRouter.post(slackToTravisCIEndpoint, controllers.slackToTravisCIController);
// add more routes (endpoint - controller pairs)...

module.exports = {
    baseUrl,

    qualitativeOrgReviewRouter,

    listOrgsEndpoint,
    slackToTravisCIEndpoint
};