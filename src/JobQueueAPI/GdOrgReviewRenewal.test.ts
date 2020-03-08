'use strict';

import { expect } from 'chai';
import axios from 'axios';
import { describe, it } from 'mocha';
import { STATUS_CODE, baseUrl } from '../utilities/serverExceptions';
import { gdOrgReviewRenewalBaseUrl, singleOrgJobEndpoint } from './routes';

export const gdOrgReviewRenewalDescribe = describe('GdOrgReviewRenewal integration test', () => {
    describe('Test job queue endpoint auth', () => {
        it('No permission', async () => {
            // no token specified - should return 401 not authenticated
            try {
                await axios.post(
                    `${baseUrl}${gdOrgReviewRenewalBaseUrl}${singleOrgJobEndpoint}`
                );
                throw new Error('Should trigger error');
            } catch (error) {
                expect(error.response.status).to.equal(
                    STATUS_CODE.NOT_AUTHENTICATED
                );
                expect(error.response.data.message).to.equal('No permission');
            }

            return;
        });

        it('No company', async () => {
            // no token specified - should return 401 not authenticated
            try {
                const res = await axios.post(
                    `${baseUrl}${gdOrgReviewRenewalBaseUrl}${singleOrgJobEndpoint}`,
                    { token: process.env.TRAVIS_TOKEN }
                );
                throw new Error('Should trigger error');
            } catch (error) {
                expect(error.response.status).to.equal(
                    STATUS_CODE.PARAMETER_REQUIREMENT_NOT_MET
                );
                expect(error.response.data.message).to.includes('No company');
            }

            return;
        });
    });

    // add more tests for controllers...
});
