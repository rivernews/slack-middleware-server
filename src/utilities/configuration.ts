import {
    SeleniumArchitectureType,
    SeleniumMicroserviceType
} from '../services/kubernetes/types';

export class Configuration {
    private static _singleton: Configuration;

    public gdReviewCountPerPage: number;
    public scraperJobSplittingSize: number;
    public crossSessionTimeLimitMinutes: number;

    public scraperConcurrency: number;
    public k8sJobConcurrency: number;
    public travisJobConcurrency: number;

    public scraperWorkerNodeCount: number;
    public scraperCountPerWorkerNode: number;

    public scraperDriverNodeCpuLimit: string;

    public seleniumArchitectureType: SeleniumArchitectureType;

    private constructor () {
        this.gdReviewCountPerPage = this._getNumberFromEnvVar(
            'GLASSDOOR_REVIEW_COUNT_PER_PAGE',
            '10'
        );

        this.scraperJobSplittingSize = this._getNumberFromEnvVar(
            'SCRAPER_JOB_SPLITTING_SIZE',
            // lower job splitted size can avoid session renewal
            '1500'
        );

        this.crossSessionTimeLimitMinutes = this._getNumberFromEnvVar(
            'CROSS_SESSION_TIME_LIMIT_MINUTES',

            // smaller chunk of task is better especially when random network-related error occurr.
            // when bull retry the scraper job, we can have less overhead
            '45'
        );

        // Resources

        this.scraperWorkerNodeCount = this._getNumberFromEnvVar(
            'SCRAPER_WORKER_NODE_COUNT',
            '1'
        );

        this.scraperCountPerWorkerNode = this._getNumberFromEnvVar(
            'SCRAPER_COUNT_PER_WORKER_NODE',
            '1'
        );

        const maximumScraperCapacity =
            this.scraperWorkerNodeCount * this.scraperCountPerWorkerNode;

        this.scraperDriverNodeCpuLimit =
            process.env.SCRAPER_DRIVER_NDOE_CPU_LIMIT || '.5';

        // Concurrency

        this.scraperConcurrency = this._getNumberFromEnvVar(
            'SCRAPER_CONCURRENCY',
            maximumScraperCapacity.toString()
        );

        this.k8sJobConcurrency = this._getNumberFromEnvVar(
            'PLATFORM_CONCURRENCY_K8S',
            this.scraperConcurrency.toString()
        );

        // this.travisJobConcurrency = this._getNumberFromEnvVar(
        //     'PLATFORM_CONCURRENCY_TRAVIS',
        //     '0'
        // );
        this.travisJobConcurrency =
            this.scraperConcurrency - this.k8sJobConcurrency;

        this.seleniumArchitectureType =
            process.env.SELENIUM_ARCHITECTURE_TYPE &&
            process.env.SELENIUM_ARCHITECTURE_TYPE in SeleniumArchitectureType
                ? ((process.env
                      .SELENIUM_ARCHITECTURE_TYPE as unknown) as SeleniumArchitectureType)
                : SeleniumArchitectureType['pod-standalone'];
    }

    private _getNumberFromEnvVar (envVarName: string, defaultValue: string) {
        return parseInt(process.env[envVarName] || defaultValue);
    }

    public static get singleton () {
        if (Configuration._singleton) {
            return Configuration._singleton;
        }

        Configuration._singleton = new Configuration();

        return Configuration._singleton;
    }
}
