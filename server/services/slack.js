'use strict';

const axios = require('axios').default;

const SLACK_TOKEN_INCOMING_URL = process.env.SLACK_TOKEN_INCOMING_URL;

const sendSlackMessage = async (message) => {
    const sanitizedMessage = (message instanceof String) ? message : JSON.stringify(message, null, 2);

    return axios.post(
        SLACK_TOKEN_INCOMING_URL,
        {
            text: sanitizedMessage
        }
    );
}

module.exports = {
    sendSlackMessage
};