import axios from 'axios';
import { ScraperJobRequestData, ScraperProgressData } from './jobQueue/types';
import { redisManager } from './redis';
import { mapJobDataToScraperEnvVar } from './jobQueue/mapJobDataToScraperEnvVar';

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

export const asyncTriggerQualitativeReviewRepoBuild = async (
    scraperJobData: ScraperJobRequestData,
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
                    ...mapJobDataToScraperEnvVar(scraperJobData)
                }
            },
            ...travisJobOption
        },
        {
            headers: getTravisCiRequestHeaders()
        }
    );
};
