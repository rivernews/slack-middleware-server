'use strict';

const slack = require('../services/slack/slack');
const travis = require('../services/travis');
const STATUS_CODE = require('../utilities/serverUtilities').STATUS_CODE;


const getCompanyInformationString = (req) => {
    let companyInformationString = req.body.company || req.query.company;
    if (companyInformationString) {
        return companyInformationString;
    }

    if (!req.body.text) {
        return null;
    }

    [companyInformationString,] = slack.parseArgsFromSlackMessage(req);

    // sanitize string
    const sanitizedString = companyInformationString.trim().replace(/[<>]/g, '');

    return sanitizedString;
}


const slackToTravisCIController = async (req, res) => {
    console.log(req.body);
    console.log(req.query);

    const slackToken = req.body.token || req.query.token;
    if (!slackToken || slackToken !== process.env.SLACK_TOKEN) {
        console.log('No token included or not correct.');
        return res.status(STATUS_CODE.NOT_AUTHENTICATED).json({ 'message': 'No permission'});
    }

    const companyInformationString = getCompanyInformationString(req);
    if (!companyInformationString) {
        console.log('No company included');
        return res.status(STATUS_CODE.PARAMETER_REQUIREMENT_NOT_MET).json({ 'message': 'No company specified, will do nothing' });
    }

    console.log(`Company info string is ${companyInformationString}`);
    
    console.log('Ready to trigger travis')
    const triggerRes = await travis.asyncTriggerQualitativeReviewRepoBuild(companyInformationString);

    if (triggerRes.status >= 400) {
        console.log('travis return abnormal response');
        console.log(triggerRes.data);
        return res.json({
            'message': 'Travis returned abnormal response',
            'travisStatus': triggerRes.status,
            'travisResponse': triggerRes.data
        }).status(triggerRes.status);
    }

    const slackRes = await slack.asyncSendSlackMessage("Trigger travis success. Below is the travis response:\n```" + JSON.stringify(triggerRes.data, null, 2) + "```");
    console.log("Slack res", slackRes);

    console.log('trigger result:\n', triggerRes.data);
    return res.json(triggerRes.data);
}


const listOrgsController = async (req, res) => {
    console.log('qualitative-org-review/list-org');
    console.log(req.body);
    console.log(req.query);

    // const [searchKeyword, ] = slack.parseArgsFromSlackMessage(req);

    // sanitize
    // const sanitizedString = searchKeyword.trim();

    // TODO: query glassdoor

    // TODO: get html page

    // TODO: parse html, find overview evidence

    // TODO: if not overview, ready to parse company url list

    res.send('OK');
}


module.exports = {
    slackToTravisCIController,
    listOrgsController
};