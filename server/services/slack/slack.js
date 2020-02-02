'use strict';

const axios = require('axios').default;

const NotAuthenticatedResponse = require('../../utilities/serverUtilities').NotAuthenticatedResponse;

const SLACK_TOKEN_INCOMING_URL = process.env.SLACK_TOKEN_INCOMING_URL;


const authenticateSlack = (slackReq, verifySlackToken) => {
    const slackToken = slackReq.body.token || slackReq.query.token;
    if (!slackToken || slackToken !== verifySlackToken) {
        console.log('No token included or not correct.');
        return false;
    }

    return true;
}

const asyncSendSlackMessage = async (message, overrideChannel = '') => {
    let finalMessage = message;

    let channelOption = {};
    if (overrideChannel) {
        channelOption['channel'] = overrideChannel;
    }

    // run in travis ci env - direct all message to #build
    // travis env var: https://docs.travis-ci.com/user/environment-variables/#default-environment-variables
    if (
        process.env.TRAVIS && process.env.CI &&
        process.env.USER === 'travis'
    ) {
        channelOption['channel'] = '#build';

        // add mark into message
        finalMessage = '(FROM TRAVIS TEST) ' + finalMessage;
    }

    return axios.post(
        SLACK_TOKEN_INCOMING_URL,
        {
            text: finalMessage,
            ...channelOption
        }
    );
}

const parseArgsFromSlackMessage = (slackReq) => {
    

    if (!slackReq.body.text) {
        return [];
    }

    const argsString = slackReq.body.text;

    const [, ...args] = argsString.split(' ').filter((argString) => argString.trim() !== '').map(argsString => argsString.trim());

    return args;
}

const parseArgsFromSlackForLaunch = (slackReq) => {
    if (!authenticateSlack(slackReq, process.env.SLACK_TOKEN_OUTGOING_LAUNCH)) {
        throw new NotAuthenticatedResponse();
    }
    return parseArgsFromSlackMessage(slackReq);
}

const parseArgsFromSlackForListOrg = (slackReq) => {
    if (!authenticateSlack(slackReq, process.env.SLACK_TOKEN_OUTGOING_LIST_ORG)) {
        throw new NotAuthenticatedResponse();
    }

    const args = parseArgsFromSlackMessage(slackReq);

    // e.g. if company name keyword contains space - 
    // so we have to recover these spaces, and
    // url encode them
    const spaceRecovered = args.join(' ');

    // encode url component
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
    const urlEncoded = encodeURIComponent(spaceRecovered);
    return {
        raw: spaceRecovered, // useful for logging
        encoded: urlEncoded // actual use in http request
    };
}

module.exports = {
    asyncSendSlackMessage,
    
    parseArgsFromSlackForLaunch,
    parseArgsFromSlackForListOrg
};