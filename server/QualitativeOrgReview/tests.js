"use strict";

const expect = require("chai").expect;
const axios = require("axios").default;

const STATUS_CODE = require("../utilities/serverUtilities").STATUS_CODE;

const baseUrl = require("../utilities/serverUtilities").baseUrl;
const qualitativeOrgReviewbaseUrl = require("./routes").baseUrl;

const listOrgsEndpoint = require("./routes").listOrgsEndpoint;
const slackToTravisCIEndpoint = require("./routes").slackToTravisCIEndpoint;
// add more endpoints of controllers...

const launchListOrgRequest = async (companyNameKeyword) => {
    const res = await axios.post(
        `${baseUrl}${qualitativeOrgReviewbaseUrl}${listOrgsEndpoint}`,
        { token: process.env.SLACK_TOKEN, text: `list ${companyNameKeyword}` }
    );
    expect(res.status).to.equal(STATUS_CODE.SUCCESS);

    return res.data;
}

const qualitativeOrgReviewOrgDescribe = describe("QualitativeOrgReview integration test", () => {
    describe('List org endpoint', () => {
        it("Multiple", async () => {
            const data = await launchListOrgRequest('stanford');

            console.log('\n\n\ndata is', data);

            expect(data)
                .to.be.an.instanceof(Array)
                .to.have.lengthOf.greaterThan(0);
            return;
        });

        it("Single", async () => {
            const data = await launchListOrgRequest('healthcrowd');
            expect(data.message).to.equal('Single result');
            return;
        });

        it("No result", async () => {
            const data = await launchListOrgRequest('xxxjojojojoxxx');
            expect(data.message).to.equal('No result');
            return;
        });
    });

    describe("Slack To TravisCI endpoint", () => {
        it("No permission", async () => {
            // no token specified - should return 401 not authenticated
            try {
                await axios.post(
                    `${baseUrl}${qualitativeOrgReviewbaseUrl}${slackToTravisCIEndpoint}`
                );
                throw new Error("Should trigger error");
            } catch (error) {
                expect(error.response.status).to.equal(
                    STATUS_CODE.NOT_AUTHENTICATED
                );
                expect(error.response.data.message).to.equal("No permission");
            }

            return;
        });

        it("No company", async () => {
            // no token specified - should return 401 not authenticated
            try {
                const res = await axios.post(
                    `${baseUrl}${qualitativeOrgReviewbaseUrl}${slackToTravisCIEndpoint}`,
                    { token: process.env.SLACK_TOKEN }
                );
                throw new Error("Should trigger error");
            } catch (error) {
                expect(error.response.status).to.equal(
                    STATUS_CODE.PARAMETER_REQUIREMENT_NOT_MET
                );
                expect(error.response.data.message).to.includes("No company");
            }

            return;
        });
    });

    // add more tests for controllers...
});

module.exports = {
    qualitativeOrgReviewOrgDescribe
};
