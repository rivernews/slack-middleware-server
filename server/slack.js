'use strict';

const axios = require('axios').default;

const SLACK_TOKEN_INCOMING_URL = process.env.SLACK_TOKEN_INCOMING_URL;

const sendSlackMessage = async (message) => {
    return axios.post(
        SLACK_TOKEN_INCOMING_URL,
        {
            payload: {
                text: message
            }
        }
    );
}
