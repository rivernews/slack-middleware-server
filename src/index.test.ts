'use strict';

import { gracefulExpressServer, cleanUpExpressServer } from '.';
import { gdOrgReviewRenewalDescribe } from './JobQueueAPI/GdOrgReviewRenewal.test';
import { qualitativeOrgReviewOrgDescribe } from './QualitativeOrgReview/QualitativeOrgReview.test';

import { expect } from 'chai';
import axios from 'axios';

import { baseUrl } from './utilities/serverExceptions';
import { asyncDump } from './asyncDump.test';

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
            console.log(
                'mocha: express server clean up finished, still waiting...'
            );

            // TODO: remove this and replace by a more effective way
            // to debug hanging async which prevents process from exiting
            // asyncDump();

            gracefulExpressServer.close(() => {
                console.log('mocha done() - safely terminated all processes');
                return Promise.resolve('OK');
            });
        })
        .catch(error => Promise.reject(error));
});
