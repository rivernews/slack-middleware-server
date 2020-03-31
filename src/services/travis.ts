import axios from 'axios';
import { ScraperJobRequestData, ScraperProgressData } from './jobQueue/types';
import { redisManager, JobQueueSharedRedisClientsSingleton } from './redis';
import { mapJobDataToScraperEnvVar } from './jobQueue/mapJobDataToScraperEnvVar';
import { ServerError } from '../utilities/serverExceptions';
import { Semaphore } from 'redis-semaphore';
import { asyncSendSlackMessage } from './slack';

// Travis API
// https://docs.travis-ci.com/user/triggering-builds/

export class TravisManager {
    private static _singleton: TravisManager;

    public travisJobResourceSemaphore: Semaphore;

    private constructor () {
        JobQueueSharedRedisClientsSingleton.singleton.intialize('master');
        if (!JobQueueSharedRedisClientsSingleton.singleton.genericClient) {
            throw new ServerError(
                'KubernetesService:jobVacancySemaphore: Shared job queue redis client did not initialize'
            );
        }

        // Current travis environment is suitable for running up to 6 jobs in parallel
        this.travisJobResourceSemaphore = new Semaphore(
            JobQueueSharedRedisClientsSingleton.singleton.genericClient,
            'travisJobResourceLock',
            6,
            {
                // when travis has no vacancy, the full situation will be
                // detected after 6 sec when someone call `.acquire()`
                acquireTimeout: 6 * 1000,
                retryInterval: 1000
            }
        );
    }

    public static get singleton () {
        if (!TravisManager._singleton) {
            TravisManager._singleton = new TravisManager();
        }
        return TravisManager._singleton;
    }
}

const USERNAME = 'rivernews';
const REPO = 'review-scraper-java-development-environment';
const FULL_REPO_NAME = `${USERNAME}/${REPO}`;
const URL_ENCODED_REPO_NAME = encodeURIComponent(FULL_REPO_NAME);
const GITHUB_ID = '15918424';
const TRAVIS_CONCURRENT_JOB_LIMIT = 6;

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

const requestTravisApi = async (
    method: 'post' | 'get' = 'get',
    endpoint: string,
    data?: any
) => {
    const url = `https://api.travis-ci.com${endpoint}`;
    if (method == 'post') {
        return axios.post(url, data, {
            headers: getTravisCiRequestHeaders()
        });
    } else {
        return axios.get(url, {
            headers: getTravisCiRequestHeaders()
        });
    }
};

export const asyncTriggerQualitativeReviewRepoBuild = async (
    scraperJobData: ScraperJobRequestData,
    travisJobOption: TravisJobOption = {}
) => {
    return requestTravisApi('post', `/repo/${URL_ENCODED_REPO_NAME}/requests`, {
        config: {
            env: {
                ...mapJobDataToScraperEnvVar(scraperJobData)
            }
        },
        ...travisJobOption
    });
};

export const checkTravisHasVacancy = async (
    currentProcessIdentifier: string
) => {
    // try semaphore first
    let travisJobResourceSemaphoreString: string;
    try {
        travisJobResourceSemaphoreString = await TravisManager.singleton.travisJobResourceSemaphore.acquire();
    } catch (error) {
        console.debug('travis semaphore acquire failed', error);
        return;
    }

    // double check vacancy with travis api

    const res = await requestTravisApi(
        'get',
        // active endpoint
        // https://developer.travis-ci.com/resource/active#Active
        `/owner/github_id/${GITHUB_ID}/active`
    );

    if (!Array.isArray(res.data.builds)) {
        throw new ServerError(
            `During ${currentProcessIdentifier}: Invalid travis api response while checking active job: ${JSON.stringify(
                res.data
            )}`
        );
    }

    const activeBuildCount = res.data.builds.length;

    console.debug(
        `During ${currentProcessIdentifier}: travis active job count is ${activeBuildCount}`
    );

    if (activeBuildCount >= TRAVIS_CONCURRENT_JOB_LIMIT) {
        await asyncSendSlackMessage(
            `🟠 During ${currentProcessIdentifier}: got travis semaphore, but travis still has too many active jobs ${activeBuildCount}; will proceed anyway, but please be aware if this is a mistake, the travis job will not carry out before active job decreases, possibly causing supervisor to time out`
        );
    }

    return travisJobResourceSemaphoreString;
};
