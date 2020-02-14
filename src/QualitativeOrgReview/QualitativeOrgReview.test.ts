'use strict';

import { expect } from 'chai';
import axios from 'axios';
import { describe, it } from 'mocha';
import { STATUS_CODE, baseUrl } from '../utilities/serverUtilities';
import {
    baseUrl as qualitativeOrgReviewbaseUrl,
    listOrgsEndpoint,
    slackToTravisCIEndpoint
} from './routes';

const simulateSlackTriggerWordListOrgRequest = async (
    companyNameKeyword: string
) => {
    const res = await axios.post(
        `${baseUrl}${qualitativeOrgReviewbaseUrl}${listOrgsEndpoint}`,
        {
            token: process.env.SLACK_TOKEN_OUTGOING_LIST_ORG,
            text: `list ${companyNameKeyword}`
        }
    );
    expect(res.status).to.equal(STATUS_CODE.SUCCESS);

    return res.data;
};

const qualitativeOrgReviewOrgDescribe = describe('QualitativeOrgReview integration test', () => {
    describe('List org endpoint', () => {
        it('Multiple', async () => {
            const data = await simulateSlackTriggerWordListOrgRequest(
                'stanford'
            );

            expect(data.results)
                .to.be.an.instanceof(Array)
                .to.have.lengthOf.greaterThan(0);
            return;
        });

        it('Single', async () => {
            const data = await simulateSlackTriggerWordListOrgRequest(
                'digitalocean'
            );
            expect(data.message).to.equal('Single result');
            return;
        });

        it('No result', async function () {
            // there're some case where this will timeout for some how
            // so adding retry specifically for this case (only retrying for timeout but it'll retry twice whatever)
            this.retries(2);
            const data = await simulateSlackTriggerWordListOrgRequest(
                'xxxjojojojoxxx'
            );
            expect(data.message).to.equal('No result');
            return;
        });
    });

    describe('Slack To TravisCI endpoint', () => {
        it('No permission', async () => {
            // no token specified - should return 401 not authenticated
            try {
                await axios.post(
                    `${baseUrl}${qualitativeOrgReviewbaseUrl}${slackToTravisCIEndpoint}`
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
                    `${baseUrl}${qualitativeOrgReviewbaseUrl}${slackToTravisCIEndpoint}`,
                    { token: process.env.SLACK_TOKEN_OUTGOING_LAUNCH }
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

module.exports = {
    qualitativeOrgReviewOrgDescribe
};
