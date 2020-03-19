import { ScraperJobRequestData, ScraperProgressData } from './types';

import { ScraperEnvironmentVariable } from '../travis';

import { redisManager } from '../redis';

export const mapJobDataToScraperEnvVar = (jobData: ScraperJobRequestData) => {
    let scraperJobEnvironmentVaribles = (Object.keys(
        jobData
    ) as (keyof ScraperJobRequestData)[]).reduce((acc, cur) => {
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
                TEST_COMPANY_LAST_PROGRESS_PROCESSED: progressData.processed,
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
