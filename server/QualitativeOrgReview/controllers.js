"use strict";

const cheerio = require("cheerio");
const axios = require("axios").default;

const slack = require("../services/slack/slack");
const travis = require("../services/travis");
const STATUS_CODE = require("../utilities/serverUtilities").STATUS_CODE;
const ParameterRequirementNotMet = require("../utilities/serverUtilities")
    .ParameterRequirementNotMet;

const getCompanyInformationString = req => {
    let companyInformationString = req.body.company || req.query.company;

    if (!companyInformationString) {
        [companyInformationString] = slack.parseArgsFromSlackMessage(req);
    }

    if (!companyInformationString) {
        return null;
    }

    // sanitize string
    // url in slack message will be auto-transformed into <...>
    // so we have to get rid of those braces
    const sanitizedString = companyInformationString
        .trim()
        .replace(/[<>]/g, "");

    return sanitizedString;
};

const slackToTravisCIController = async (req, res, next) => {
    console.log(req.body);
    console.log(req.query);

    let companyInformationString;

    try {
        companyInformationString = getCompanyInformationString(req);
        if (!companyInformationString) {
            console.log("No company included");
            throw new ParameterRequirementNotMet(
                "No company specified, will do nothing"
            );
        }

        console.log(`Company info string is ${companyInformationString}`);

        console.log("Ready to trigger travis");
        const triggerRes = await travis.asyncTriggerQualitativeReviewRepoBuild(
            companyInformationString
        );

        if (triggerRes.status >= 400) {
            console.log("travis return abnormal response");
            console.log(triggerRes.data);
            return res
                .json({
                    message: "Travis returned abnormal response",
                    travisStatus: triggerRes.status,
                    travisResponse: triggerRes.data
                })
                .status(triggerRes.status);
        }

        const slackRes = await slack.asyncSendSlackMessage(
            "Trigger travis success. Below is the travis response:\n```" +
                JSON.stringify(triggerRes.data, null, 2) +
                "```"
        );
        console.log("Slack res", slackRes);

        console.log("trigger result:\n", triggerRes.data);
        return res.json(triggerRes.data);
    } catch (error) {
        return next(error);
    }
};

const parseGlassdoorResultPage = locater => {
    const glassBaseUrl = `http://glassdoor.com`;

    let results = locater();
    let companyList = [];
    results.each((index, element) => {
        companyList.push({
            name: element.firstChild.data.trim(),
            url: `${glassBaseUrl}${element.attribs.href}`
        });
    });

    return companyList;
};

const getGlassdoorQueryUrl = companyNameKeyword => {
    return `https://www.glassdoor.com/Reviews/company-reviews.htm?suggestCount=10&suggestChosen=false&clickSource=searchBtn&typedKeyword=${companyNameKeyword}&sc.keyword=${companyNameKeyword}&locT=C&locId=&jobType=`;
};

const beautifyCompanyListResultString = (results) => {
    return results.reduce((accumulate, current) => {
        const newResultString = `<${current.url} | ${current.name}>\n\n`;
        return accumulate + newResultString;
    }, '');
}

const getListOrgsControllerSlackMessage = (results, queryUrl) => {
    return (
        "Company list (1st page):\n\n" +
        beautifyCompanyListResultString(results)+
        "\n\nUse `launch <url>` to start scraper. If you don't find the right company on the list, you may go to the url below to check for next pages yourself (if search result has multiple pages):\n" +
        queryUrl
    );
};

const listOrgsController = async (req, res, next) => {
    console.log("qualitative-org-review/list-org");
    console.log(req.body);
    console.log(req.query);

    // when using async function, needs to handle the error and then pass
    // error to next()
    // https://expressjs.com/en/guide/error-handling.html
    try {
        const [companyNameKeyword] = slack.parseArgsFromSlackMessage(req);

        const queryUrl = getGlassdoorQueryUrl(companyNameKeyword);
        const glassRes = await axios(queryUrl);
        const $ = cheerio.load(glassRes.data);

        // single result test
        const singleResultTest = ($("#EI-Srch").data("page-type") || "").trim();
        if (singleResultTest === "OVERVIEW") {
            console.log("single test: " + singleResultTest);
            await slack.asyncSendSlackMessage(`You searched ${companyNameKeyword}:\nSingle result. Use \`launch ${companyNameKeyword}\` to start the scraper.`);
            return res.json({ 'message': 'Single result' });
        }

        // handle multiple result
        console.log("multiple results!");
        // first attempt
        let results = parseGlassdoorResultPage(() => {
            return $("#MainCol")
                .find("div.module")
                .find("div.margBotXs > a");
        });
        console.log(`1st method: we got ${results.length} results`);
        if (results && results.length) {
            await slack.asyncSendSlackMessage(
                getListOrgsControllerSlackMessage(results, queryUrl)
            );
            return res.json(results);
        }
        // 2nd attempt
        results = parseGlassdoorResultPage(() => {
            return $("#MainCol")
                .find("div.single-company-result")
                .find("h2 > a");
        });
        console.log(`2nd method: we got ${results.length} results`);
        if (results && results.length) {
            await slack.asyncSendSlackMessage(
                getListOrgsControllerSlackMessage(results, queryUrl)
            );
            return res.json(results);
        }

        // No result
        console.log('No results');
        await slack.asyncSendSlackMessage(`You searched ${companyNameKeyword}:\nNo result. You may <${queryUrl} |take a look at the actual result page> to double check.`);

        res.json({
            'message': 'No result',
            'html': glassRes.data
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    slackToTravisCIController,
    listOrgsController
};
