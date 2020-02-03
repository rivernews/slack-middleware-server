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
        finalMessage = '(FROM TRAVIS TEST) ' + finalMessage;
    } else if (process.env.NODE_ENV !== 'production') {
        channelOption['channel'] = '#build';
        finalMessage = '(LOCAL DEBUG MODE) ' + finalMessage;
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
    let companyInformationString = slackReq.body.company || slackReq.query.company;
    if (!companyInformationString) {
        if (!authenticateSlack(slackReq, process.env.SLACK_TOKEN_OUTGOING_LAUNCH)) {
            throw new NotAuthenticatedResponse();
        }
        [companyInformationString, ] = parseArgsFromSlackMessage(slackReq);
    }

    if (!companyInformationString) {
        return null;
    }

    // sanitize string
    // url in slack message will be auto-transformed into <...>
    // so we have to get rid of those braces
    const sanitizedString = companyInformationString
        .trim()
        // remove hyperlink markdown like <http://.....|...> => http://...
        .replace(/[<]([^<>\|]+)([\|][^<>\|]+)?[>]/g, (match, cap1, cap2, offset, originalString) => {
            console.log(`\noriginal string:\n${originalString}`);
            console.log(`\nhyperlink removed:\n${cap1}`);
            return cap1;
        }).trim();

    return sanitizedString;
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