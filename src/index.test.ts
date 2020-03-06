'use strict';

import { gracefulExpressServer, cleanUpExpressServer } from '.';
import { gdOrgReviewRenewalDescribe } from './GdOrgReviewRenewal/GdOrgReviewRenewal.test';
import { qualitativeOrgReviewOrgDescribe } from './QualitativeOrgReview/QualitativeOrgReview.test';

const expect = require('chai').expect;
const axios = require('axios').default;

const baseUrl = require('./utilities/serverExceptions').baseUrl;

describe('App integration test', () => {
    it('Index page', async () => {
        const res = await axios.get(baseUrl);
        expect(res.status).to.equal(200);
        return;
    });

    qualitativeOrgReviewOrgDescribe;
    gdOrgReviewRenewalDescribe;
});

after(done => {
    console.log('mocha:after');
    cleanUpExpressServer()
        .then(() => {
            console.log('mocha: cleanup fin, closing...');
            gracefulExpressServer.close(() => {
                console.log('mocha done() - safely terminated');
                return done();
            });
        })
        .catch(error => done(error));
});
