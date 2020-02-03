"use strict";

const cheerio = require("cheerio");
const axios = require("axios").default;
const isEmpty = require('lodash/isEmpty');

const slack = require("../services/slack/slack");
const travis = require("../services/travis");
const ParameterRequirementNotMet = require("../utilities/serverUtilities")
    .ParameterRequirementNotMet;
const htmlParseHelper = require('../services/htmlParser');

const GLASSDOOR_BASE_URL = `https://www.glassdoor.com`;


const slackToTravisCIController = async (req, res, next) => {
    let companyInformationString;

    try {
        companyInformationString = slack.parseArgsFromSlackForLaunch(req);
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

const parseCompaniesFromGlassdoorMultipleResultPage = (locator, $) => {
    
    const {
        singleOrgElements,
        getOverviewLinkElement,
        getReviewLinkElement
    } = locator();

    console.log("INFO: single org list size: ", singleOrgElements.length);
    
    let companyTable = {};
    singleOrgElements.each((index, singleOrgElement) => {
        // get located Cheerio object
        const overviewLinkElement = getOverviewLinkElement($(singleOrgElement));
        const reviewLinkElement = getReviewLinkElement($(singleOrgElement));

        // Cheerio object returned by find() needs a existence check
        // Because the glassdoor page may have different version
        // If both Cheerio object is empty DOM, then just abort (hopefully will be retrieved by next attempt)
        if (!(overviewLinkElement.length && reviewLinkElement.length)) {
            return;
        }

        let companyMetadata = null;
        try {
            const url = `${GLASSDOOR_BASE_URL}${overviewLinkElement[0].attribs.href}`;
            const name = overviewLinkElement[0].firstChild.data.trim();
            const globalReviewNumberText = reviewLinkElement[0].firstChild.data.trim();

            companyMetadata = {
                name,
                url,
                globalReviewNumberText
            }
            companyTable[url] = companyMetadata;
        } catch (error) {
            if (error instanceof TypeError) {
                console.log('Even if single org element located, still cannot retrieve data. Possibly the page structure has changed, please try to fetch the page source and investigate.', error)
            } else {
                throw error;
            }
        }
    });

    return companyTable;
};

const getGlassdoorQueryUrl = companyNameKeyword => {
    return `${GLASSDOOR_BASE_URL}/Reviews/company-reviews.htm?suggestCount=10&suggestChosen=false&clickSource=searchBtn&typedKeyword=${companyNameKeyword}&sc.keyword=${companyNameKeyword}&locT=C&locId=&jobType=`;
};

const beautifyCompanyTableResultString = companyList => {
    return companyList.reduce((accumulate, current) => {
        const newResultString = `${current.globalReviewNumberText} global review(s), <${current.url} | ${current.name}>\n\n`;
        return accumulate + newResultString;
    }, "");
};

const getListOrgsControllerSlackMessage = (companyList, queryUrl) => {
    return (
        "Company list (1st page):\n\n" +
        beautifyCompanyTableResultString(companyList) +
        "\n\nUse `::launch <url>` to start scraper. If you don't find the right company on the list, you may go to the url below to check for next pages yourself (if search result has multiple pages):\n" +
        queryUrl
    );
};

const listOrgsController = async (req, res, next) => {
    console.log("listOrgsController() invoked");

    // when using async function, needs to handle the error and then pass
    // error to next()
    // https://expressjs.com/en/guide/error-handling.html
    try {
        const companyNameKeyword = slack.parseArgsFromSlackForListOrg(req);

        const queryUrl = getGlassdoorQueryUrl(companyNameKeyword.encoded);
        console.log('querying url:', queryUrl);
        const glassRes = await axios(queryUrl);
        const $ = cheerio.load(glassRes.data);

        // single result test
        const singleResultTest = ($("#EI-Srch").data("page-type") || "").trim();
        if (singleResultTest === "OVERVIEW") {
            // also scrape global review count text
            const reviewCheerioElement = htmlParseHelper.cssSelectorToChainedFindFromCheerioElement(
                $("#EI-Srch"), 'article[id*=WideCol] a.eiCell.reviews span.num'
            );
            const globalReviewNumberText = (reviewCheerioElement.length) ? reviewCheerioElement[0].firstChild.data.trim() : null;
            const globalReviewNumberSlackMessage = globalReviewNumberText ? `${globalReviewNumberText} global review(s).` : `Cannot get global review info, please check html content:\n\`\`\`${glassRes.data}\`\`\`\n`;

            console.log("single test: " + singleResultTest);
            await slack.asyncSendSlackMessage(
                `You searched ${companyNameKeyword.raw}:\n<${queryUrl}|Single result link>. ${globalReviewNumberSlackMessage}\nUse \`::launch ${companyNameKeyword.raw}\` to start the scraper.`
            );
            return res.json({ message: "Single result" });
        }

        // handle multiple result
        console.log("Not single. Check if it's multiple results...");

        // first attempt
        let companyTable = parseCompaniesFromGlassdoorMultipleResultPage(
            () => {
                return {
                    singleOrgElements: $("#MainCol").find("div.module"),
                    getOverviewLinkElement: singleOrgElement =>
                        singleOrgElement.find("div.margBotXs > a").first(),
                    getReviewLinkElement: singleOrgElement =>
                        singleOrgElement
                            .find("div.empLinks")
                            .find("a.eiCell.reviews")
                            .find("span.num")
                            .first()
                };
            },
            $
        );
        let companyList = Object.values(companyTable);
        console.log(`1st method: we got ${Object.keys(companyList).length} results`);
        if (!isEmpty(companyList)) {
            console.log('picking up results');
            await slack.asyncSendSlackMessage(
                `You searched ${companyNameKeyword.raw} =\n` +
                getListOrgsControllerSlackMessage(Object.values(companyList), queryUrl)
            );
            return res.json({
                results: companyList,
                html: glassRes.data
            });
        }
        
        // 2nd attempt
        companyTable = parseCompaniesFromGlassdoorMultipleResultPage(
            () => {
                return {
                    singleOrgElements: $("#MainCol").find(
                        "div.single-company-result"
                    ),
                    getOverviewLinkElement: singleOrgElement =>
                        singleOrgElement.find("h2 > a").first(),
                    getReviewLinkElement: singleOrgElement =>
                        singleOrgElement
                            .find("div.ei-contribution-wrap")
                            .find("a.eiCell.reviews")
                            .find("span.num")
                            .first()
                };
            },
            $
        );
        companyList = Object.values(companyTable);
        console.log(`2nd method: we got ${companyList.length} results`);
        if (!isEmpty(companyList)) {
            console.log('picking up results');
            await slack.asyncSendSlackMessage(
                `You searched ${companyNameKeyword.raw} =\n` +
                getListOrgsControllerSlackMessage(Object.values(companyList), queryUrl)
            );
            return res.json({
                results: companyList,
                html: glassRes.data
            });
        }

        // No result
        console.log("No results");
        await slack.asyncSendSlackMessage(
            `You searched ${companyNameKeyword.raw}:\nNo result. You may <${queryUrl} |take a look at the actual result page> to double check.`
        );

        res.json({
            message: "No result",
            html: glassRes.data
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    slackToTravisCIController,
    listOrgsController
};
