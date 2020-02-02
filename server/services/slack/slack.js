'use strict';

const axios = require('axios').default;

const STATUS_CODE = require('../../utilities/serverUtilities').STATUS_CODE;
const NotAuthenticatedResponse = require('../../utilities/serverUtilities').NotAuthenticatedResponse;
const ParameterRequirementNotMet = require('../../utilities/serverUtilities').ParameterRequirementNotMet;

const SLACK_TOKEN_INCOMING_URL = process.env.SLACK_TOKEN_INCOMING_URL;


const authenticateSlack = (slackReq) => {
    const slackToken = slackReq.body.token || slackReq.query.token;
    if (!slackToken || slackToken !== process.env.SLACK_TOKEN) {
        console.log('No token included or not correct.');
        return false;
    }

    return true;
}

const asyncSendSlackMessage = async (message) => {
    return axios.post(
        SLACK_TOKEN_INCOMING_URL,
        {
            text: message
        }
    );
}


const parseArgsFromSlackMessage = (slackReq) => {
    if (!authenticateSlack(slackReq)) {
        throw new NotAuthenticatedResponse();
    }

    if (!slackReq.body.text) {
        return [];
    }

    const argsString = slackReq.body.text;

    const [, ...args] = argsString.split(' ').filter((argString) => argString.trim() !== '').map(argsString => argsString.trim());

    return args;
}


module.exports = {
    asyncSendSlackMessage,
    parseArgsFromSlackMessage
};