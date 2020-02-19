'use strict';

const expect  = require('chai').expect;
const axios = require('axios').default;

const server = require('./index').nodeServer;
const baseUrl = require('./utilities/serverUtilities').baseUrl;


describe('App integration test', () => {
    it('Index page', async () => {
        const res = await axios.get(baseUrl);
        expect(res.status).to.equal(200);
        return;
    });

    require('./QualitativeOrgReview/QualitativeOrgReview.test').qualitativeOrgReviewOrgDescribe;
});

after(done => {
    server.close(done);
});