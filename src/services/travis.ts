import axios from 'axios';
import { ScraperJobRequestData } from './jobQueue/types';
import { JobQueueSharedRedisClientsSingleton } from './redis';
import { mapJobDataToScraperEnvVar } from './jobQueue/mapJobDataToScraperEnvVar';
import { ServerError } from '../utilities/serverExceptions';
import { Semaphore } from 'redis-semaphore';
import { asyncSendSlackMessage } from './slack';
import { RuntimeEnvironment } from '../utilities/runtime';

// Constants

// Depends on travis job setup time. Usually, till scraper launched & publish request ack is around 1 min 15 sec after travis build scheduled.
// However, there's a record this took longer than 4 minutes: https://travis-ci.com/rivernews/review-scraper-java-development-environment/builds/152118738
// hence we are raising the timeout even more, see defaults below.
// you can also set this via environment variable
export const TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS = process.env
    .TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS
    ? parseInt(process.env.TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS)
    : process.env.NODE_ENV === RuntimeEnvironment.PRODUCTION
    ? // default to 10 minutes in production
      10 * 60 * 1000
    : // default to 3 minutes in development so in case of memory leak the job can be timed out faster
      4 * 60 * 1000;

// Travis API
// https://docs.travis-ci.com/user/triggering-builds/

class TravisJob {
    constructor (public requestId: string, public buildIds: string[] = []) {}
}

export class TravisManager {
    private static _singleton: TravisManager;

    // travis api usage: `/repo/12573286`
    private static SCRAPER_REPO_TRAVIS_ID = '12381608';

    private trackingTravisJobs: TravisJob[] = [];
    private trackingSchedulers: NodeJS.Timeout[] = [];

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
            parseInt(process.env.PLATFORM_CONCURRENCY_TRAVIS || '6'),
            {
                // when travis has no vacancy, the full situation will be
                // detected after 6 sec when someone call `.acquire()`
                acquireTimeout: 20 * 1000,
                retryInterval: 5 * 1000
            }
        );
    }

    public static get singleton () {
        if (!TravisManager._singleton) {
            TravisManager._singleton = new TravisManager();
        }
        return TravisManager._singleton;
    }

    public static async requestTravisApi (
        method: 'post' | 'get' = 'get',
        endpoint: string,
        data?: any
    ) {
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
    }

    public async asyncTriggerJob (
        scraperJobData: ScraperJobRequestData,
        travisJobOption: TravisJobOption = {}
    ) {
        return TravisManager.requestTravisApi(
            'post',
            `/repo/${URL_ENCODED_REPO_NAME}/requests`,
            {
                // override commit message shown in travis job if necessary
                // message: `${scraperJobData.orgInfo || scraperJobData.orgName}:${scraperJobData.lastProgress ? scraperJobData.lastProgress.processedSession : '0'} triggered scraper job (override commit message)`,
                config: {
                    env: {
                        ...mapJobDataToScraperEnvVar(scraperJobData)
                    }
                },
                // TODO: undo
                branch: 'SLK_066_job_splitting',
                // branch: 'master',
                ...travisJobOption
            }
        ).then(requestResult => {
            if (!requestResult.data.request || !requestResult.data.request.id) {
                throw new Error(`Cannot locate job id in travis response`);
            }

            console.log(
                `job for \`${scraperJobData.orgName ||
                    scraperJobData.orgInfo}\` requested travis job successfully: ${
                    requestResult.data.request.id
                }/${requestResult.data['@type']}, remaining_requests=${
                    requestResult.data['remaining_requests']
                }`
            );

            const travisJob = new TravisJob(requestResult.data.request.id);
            this.trackingTravisJobs.push(travisJob);

            return this.pollingBuildProvisioning(travisJob);
        });
    }

    private pollingBuildProvisioning (travisJob: TravisJob) {
        return new Promise<{ builds: Array<{ id: number }> }>(
            (resolve, reject) => {
                // Wait till the build started and a build id provisioned
                // then we can store this build id for later-on cancellation
                // Only waiting for 3 minutes
                const MAX_POLLING_COUNT =
                    (TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS / 60 / 1000 -
                        1) *
                    6;
                let pollingCount = 0;
                const buildProvisionedPolling = setInterval(async () => {
                    console.log(
                        `Travis checking build status for request ${travisJob.requestId} (polled count ${pollingCount})...`
                    );
                    const requestInfo = (
                        await TravisManager.requestTravisApi(
                            'get',
                            `/repo/${TravisManager.SCRAPER_REPO_TRAVIS_ID}/request/${travisJob.requestId}`
                        )
                    ).data;
                    pollingCount++;

                    if (requestInfo.builds && requestInfo.builds.length) {
                        for (const build of requestInfo.builds) {
                            travisJob.buildIds.push(build.id);
                        }
                        console.log(`Got build id!`, travisJob.buildIds);
                        this.clearAllSchedulers();
                        return resolve(requestInfo);
                    }

                    console.log(
                        'No build info in travis request yet',
                        requestInfo
                    );

                    if (pollingCount >= MAX_POLLING_COUNT) {
                        this.clearAllSchedulers();
                        return reject(
                            new Error(
                                `Travis manager retried ${pollingCount} times to get build id of request ${
                                    travisJob.requestId
                                } but still failed. Request info: ${JSON.stringify(
                                    requestInfo
                                )}`
                            )
                        );
                    }
                }, 10 * 1000);
                this.trackingSchedulers.push(buildProvisionedPolling);
            }
        );
    }

    public clearAllSchedulers () {
        for (const scheduler of this.trackingSchedulers) {
            clearInterval(scheduler);
        }
        this.trackingSchedulers = [];
    }

    /**
     * Call this function when receive finalized signal from travis job,
     * such as FINISH or ERROR, because this means that travis job will end soon
     * so no need to track them anymore.
     * Otherwise, we should always keep track of job ids, so that they are cleaned up
     * by `cancelAllJobs`
     */
    public resetTrackingJobs () {
        this.trackingTravisJobs = [];
    }

    public async cancelAllJobs () {
        return Promise.all(
            this.trackingTravisJobs
                .map(travisJob => travisJob.buildIds)
                // flatten all build ids into a single array
                .reduce((acc, cur) => {
                    return [...acc, ...cur];
                }, [])
                .map(buildId =>
                    TravisManager.requestTravisApi(
                        'post',
                        `/build/${buildId}/cancel`
                    )
                        .then(res => res.data)
                        .catch(error => {
                            console.log(
                                `Ignoring travis build ${buildId} cancel failure: ${JSON.stringify(
                                    error
                                )}`
                            );
                            return Promise.resolve(error);
                        })
                        .then(result => {
                            this.resetTrackingJobs();
                            return result;
                        })
                )
        );
    }
}

const USERNAME = 'rivernews';
const REPO = 'review-scraper-java-development-environment';
const GITHUB_REPO_ID = '234665976';

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
    TEST_COMPANY_NEXT_REVIEW_PAGE_URL?: string;
    TEST_COMPANY_STOP_AT_PAGE?: string;
    TEST_COMPANY_SHARD_INDEX?: string;
    SCRAPER_MODE?: string;
    SUPERVISOR_PUBSUB_REDIS_DB?: string;
    SUPERVISOR_PUBSUB_CHANNEL_NAME?: string;

    // additional parameters
    LOGGER_LEVEL?: string;
    CROSS_SESSION_TIME_LIMIT_MINUTES?: string;
}

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

    const res = await TravisManager.requestTravisApi(
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
