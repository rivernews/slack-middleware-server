'use strict';

import { gracefulExpressServer, cleanUpExpressServer } from '.';
import { gdOrgReviewRenewalDescribe } from './GdOrgReviewRenewal/GdOrgReviewRenewal.test';
import { qualitativeOrgReviewOrgDescribe } from './QualitativeOrgReview/QualitativeOrgReview.test';

import { expect } from 'chai';
import axios from 'axios';

import { baseUrl } from './utilities/serverExceptions';

describe('App integration test', () => {
    it('Index page', async () => {
        const res = await axios.get(baseUrl);
        expect(res.status).to.equal(200);
        return;
    });

    qualitativeOrgReviewOrgDescribe;
    gdOrgReviewRenewalDescribe;
});

after(() => {
    console.log('mocha:after');
    return cleanUpExpressServer()
        .then(() => {
            console.log('mocha: cleanup fin, closing...');
            gracefulExpressServer.close(() => {
                console.log('mocha done() - safely terminated');
                return Promise.resolve('OK');
            });
        })
        .catch(error => Promise.reject(error));
});
