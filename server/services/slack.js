'use strict';

const axios = require('axios').default;

const SLACK_TOKEN_INCOMING_URL = process.env.SLACK_TOKEN_INCOMING_URL;

const asyncSendSlackMessage = async (message) => {
    const sanitizedMessage = (message instanceof String) ? message : JSON.stringify(message, null, 2);

    return axios.post(
        SLACK_TOKEN_INCOMING_URL,
        {
            text: sanitizedMessage
        }
    );
}


const parseArgsFromSlackMessage = (slackReq) => {
    if (!slackReq.body.text) {
        return null;
    }

    const argsString = slackReq.body.text;

    const [, ...args] = argsString.split(' ').filter((argString) => argString.trim() !== '');

    return args;
}


module.exports = {
    asyncSendSlackMessage,
    parseArgsFromSlackMessage
};