import axios from 'axios';
import {
    ScraperJobData,
    ScraperProgressData
} from './jobQueue/gdOrgReviewRenewal/scraperJob/queue';

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
    TEST_COMPANY_LAST_PROGRESS_PROCESSED?: string;
    TEST_COMPANY_LAST_PROGRESS_WENTTHROUGH?: string;
    TEST_COMPANY_LAST_PROGRESS_TOTAL?: string;
    TEST_COMPANY_LAST_REVIEW_PAGE_URL?: string;
    SCRAPER_MODE?: string;
}

const jobDataMapToScraperEnvVar = (jobData: ScraperJobData) => {
    const scraperJobEnvironmentVaaribles = (Object.keys(
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
        } else if (cur === 'lastProgress') {
            const progressData = jobData[cur] as ScraperProgressData;
            return {
                ...acc,
                TEST_COMPANY_LAST_PROGRESS_PROCESSED: progressData.procressed,
                TEST_COMPANY_LAST_PROGRESS_WENTTHROUGH:
                    progressData.wentThrough,
                TEST_COMPANY_LAST_PROGRESS_TOTAL: progressData.total
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

    return scraperJobEnvironmentVaaribles;
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
