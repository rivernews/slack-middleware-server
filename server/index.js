'use strict';

const express = require('express');
const axios = require('axios').default;

const slack = require('./slack');

// Constants
const PORT = parseInt(process.env.PORT);
const HOST = process.env.HOST;

// App
const app = express();

// App Config
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

app.get('/', (req, res) => {
    res.send('Hello! This is our slack service.');
});

const getCompanyInformationString = (req) => {
    let companyInformationString = req.body.company || req.query.company;
    if (companyInformationString) {
        return companyInformationString;
    }

    if (!req.body.text) {
        return null;
    }

    const slackMessage = req.body.text;
    [, companyInformationString] = slackMessage.split(' ');

    return companyInformationString;
}

const getTravisCiRequestHeaders = () => {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Travis-API-Version': '3',
        'Authorization': 'token ' + process.env.TRAVIS_TOKEN
    };
}

app.post('/qualitative-org-review/slack-to-travisci', async (req, res) => {
    console.log(req.body);
    console.log(req.query);

    const slackToken = req.body.token || req.query.token;
    if (!slackToken || slackToken !== process.env.SLACK_TOKEN) {
        console.log('No token included or not correct.');
        return res.json({ 'message': 'No permission'}).status(403);
    }

    const companyInformationString = getCompanyInformationString(req);
    if (!companyInformationString) {
        console.log('No company included');
        return res.json({ 'message': 'No company specified, will do nothing' });
    }

    console.log(`Company info string is ${companyInformationString}`);

    const username = 'rivernews';
    const repo = 'review-scraper-java-development-environment';
    const fullRepoName = `${username}/${repo}`;
    const urlEncodedRepoName = encodeURIComponent(fullRepoName);
    
    console.log('Ready to trigger travis')
    const triggerRes = await axios.post(
        `https://api.travis-ci.com/repo/${urlEncodedRepoName}/requests`,
        {
            config: {
                env: {
                    TEST_COMPANY_INFORMATION_STRING: companyInformationString
                }
            }
        },
        {
            headers: getTravisCiRequestHeaders()
        }
    );

    if (triggerRes.status >= 400) {
        console.log('travis return abnormal response');
        console.log(triggerRes.data);
        return res.json({
            'message': 'Travis returned abnormal response',
            'travisStatus': triggerRes.status,
            'travisResponse': triggerRes.data
        }).status(triggerRes.status);
    }

    const slackRes = await slack.sendSlackMessage("Trigger travis success. Below is the travis response:\n" + JSON.stringify(triggerRes.data));
    console.log("Slack res", slackRes);

    console.log('trigger result:\n', triggerRes.data);
    return res.json(triggerRes.data);
});

// TODO: explore travisCI API
// https://developer.travis-ci.com/resource/requests#Requests

// Bootstrap server

app.listen(PORT, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
});
