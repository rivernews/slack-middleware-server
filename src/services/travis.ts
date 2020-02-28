import axios from 'axios';
import { ScraperJobData, ScraperProgressData } from './jobQueue/types';
import { redisManager } from './redis';

// Travis API
// https://docs.travis-ci.com/user/triggering-builds/

export interface TravisJobOption {
    branch?: string;
}

const getTravisCiRequestHeaders = () => {
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Travis-API-Version': '3',
        Authorization: 'token ' + process.env.TRAVIS_TOKEN
    };
};

export interface ScraperEnvironmentVariable {
    TEST_COMPANY_INFORMATION_STRING?: string;
    TEST_COMPANY_ID?: string;
    TEST_COMPANY_NAME?: string;
    TEST_COMPANY_LAST_PROGRESS_PROCESSED?: string;
    TEST_COMPANY_LAST_PROGRESS_WENTTHROUGH?: string;
    TEST_COMPANY_LAST_PROGRESS_TOTAL?: string;
    TEST_COMPANY_LAST_PROGRESS_DURATION?: string;
    TEST_COMPANY_LAST_PROGRESS_SESSION?: string;
    TEST_COMPANY_LAST_PROGRESS_PAGE?: string;
    TEST_COMPANY_LAST_REVIEW_PAGE_URL?: string;
    SCRAPER_MODE?: string;
    SUPERVISOR_PUBSUB_REDIS_DB?: string;
}

const jobDataMapToScraperEnvVar = (jobData: ScraperJobData) => {
    let scraperJobEnvironmentVaribles = (Object.keys(
        jobData
    ) as (keyof ScraperJobData)[]).reduce((acc, cur) => {
        if (cur === 'orgInfo') {
            return {
                ...acc,
                TEST_COMPANY_INFORMATION_STRING: jobData[cur]
            };
        } else if (cur === 'orgId') {
            return {
                ...acc,
                TEST_COMPANY_ID: jobData[cur]
            };
        } else if (cur === 'orgName') {
            return {
                ...acc,
                TEST_COMPANY_NAME: jobData[cur]
            };
        } else if (cur === 'lastProgress') {
            const progressData = jobData[cur] as ScraperProgressData;
            return {
                ...acc,
                TEST_COMPANY_LAST_PROGRESS_PROCESSED: progressData.procressed,
                TEST_COMPANY_LAST_PROGRESS_WENTTHROUGH:
                    progressData.wentThrough,
                TEST_COMPANY_LAST_PROGRESS_TOTAL: progressData.total,
                TEST_COMPANY_LAST_PROGRESS_DURATION:
                    progressData.durationInMilli,
                TEST_COMPANY_LAST_PROGRESS_PAGE: progressData.page,
                TEST_COMPANY_LAST_PROGRESS_SESSION:
                    progressData.processedSession
            };
        } else if (cur === 'lastReviewPage') {
            return {
                ...acc,
                TEST_COMPANY_LAST_REVIEW_PAGE_URL: jobData[cur]
            };
        } else {
            return {
                ...acc,
                SCRAPER_MODE: jobData[cur]
            };
        }
    }, {}) as ScraperEnvironmentVariable;

    // adding additional variables
    scraperJobEnvironmentVaribles = {
        ...scraperJobEnvironmentVaribles,

        TEST_COMPANY_INFORMATION_STRING:
            scraperJobEnvironmentVaribles.TEST_COMPANY_INFORMATION_STRING || '',

        SUPERVISOR_PUBSUB_REDIS_DB: redisManager.config.db.toString()
    };

    return scraperJobEnvironmentVaribles;
};

export const asyncTriggerQualitativeReviewRepoBuild = async (
    scraperJobData: ScraperJobData,
    travisJobOption: TravisJobOption = {}
) => {
    const username = 'rivernews';
    const repo = 'review-scraper-java-development-environment';
    const fullRepoName = `${username}/${repo}`;
    const urlEncodedRepoName = encodeURIComponent(fullRepoName);

    return axios.post(
        `https://api.travis-ci.com/repo/${urlEncodedRepoName}/requests`,
        {
            config: {
                env: {
                    ...jobDataMapToScraperEnvVar(scraperJobData)
                }
            },
            ...travisJobOption
        },
        {
            headers: getTravisCiRequestHeaders()
        }
    );
};
