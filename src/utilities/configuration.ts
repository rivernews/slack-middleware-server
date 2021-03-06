import {
    SeleniumArchitectureType,
    SeleniumMicroserviceType,
    DigitalOceanDropletSize
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
    public slackMiddlewareServiceReplica: number;

    public globalMaximumScraperCapacity: number;
    public localMaximumScraperCapacity: number;

    public scraperDriverNodeCpuLimit: string;
    public scraperDriverNodeCpuRequest: string;
    public scraperDriverNodeMemoryLimit: string;
    public scraperDriverNodeMemoryRequest: string;

    public seleniumArchitectureType: SeleniumArchitectureType;

    public autoDigitaloceanDropletSize: DigitalOceanDropletSize;

    public s3DispatchJobIntervalMs: number;

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

        this.s3DispatchJobIntervalMs = this._getNumberFromEnvVar(
            'S3_DISPATCH_JOB_INTERVAL_MS',
            '600'
        );

        // Resources

        this.slackMiddlewareServiceReplica = this._getNumberFromEnvVar(
            'SLK_REPLICA',
            '1'
        );

        this.scraperWorkerNodeCount =
            this._getNumberFromEnvVar('SCRAPER_WORKER_NODE_COUNT', '1') *
            this.slackMiddlewareServiceReplica;

        this.scraperCountPerWorkerNode = this._getNumberFromEnvVar(
            'SCRAPER_COUNT_PER_WORKER_NODE',
            '1'
        );

        // this value is across replica
        this.globalMaximumScraperCapacity =
            this.scraperWorkerNodeCount * this.scraperCountPerWorkerNode;

        // this value is within this replica
        this.localMaximumScraperCapacity = Math.floor(
            this.globalMaximumScraperCapacity /
                this.slackMiddlewareServiceReplica
        );

        this.scraperDriverNodeCpuLimit =
            process.env.SCRAPER_DRIVER_NDOE_CPU_LIMIT || '.5';
        this.scraperDriverNodeCpuRequest =
            process.env.SCRAPER_DRIVER_NDOE_CPU_REQUEST || '.2';
        this.scraperDriverNodeMemoryLimit =
            process.env.SCRAPER_DRIVER_NDOE_MEMORY_LIMIT || '1000Mi';
        this.scraperDriverNodeMemoryRequest =
            process.env.SCRAPER_DRIVER_NDOE_MEMORY_REQUEST || '300Mi';

        // Concurrency

        this.scraperConcurrency = this._getNumberFromEnvVar(
            'SCRAPER_CONCURRENCY',
            this.localMaximumScraperCapacity.toString()
        );

        this.k8sJobConcurrency = this._getNumberFromEnvVar(
            'PLATFORM_CONCURRENCY_K8S',
            this.scraperConcurrency.toString()
        );

        this.travisJobConcurrency = this._getNumberFromEnvVar(
            'PLATFORM_CONCURRENCY_TRAVIS',
            (this.scraperConcurrency - this.k8sJobConcurrency).toString()
        );

        this.seleniumArchitectureType =
            process.env.SELENIUM_ARCHITECTURE_TYPE &&
            process.env.SELENIUM_ARCHITECTURE_TYPE in SeleniumArchitectureType
                ? ((process.env
                      .SELENIUM_ARCHITECTURE_TYPE as unknown) as SeleniumArchitectureType)
                : SeleniumArchitectureType['pod-standalone'];

        // choosing the optimal size with cost efficiency
        // considering the 'Maximum Pod Allocatable Memory'
        // https://www.digitalocean.com/docs/kubernetes/#allocatable-memory
        if (this.scraperCountPerWorkerNode <= 1) {
            this.autoDigitaloceanDropletSize = DigitalOceanDropletSize.SMALL_3G;
        } else if (this.scraperCountPerWorkerNode <= 3) {
            this.autoDigitaloceanDropletSize = DigitalOceanDropletSize.MEDIUM;
        } else if (this.scraperCountPerWorkerNode <= 4) {
            this.autoDigitaloceanDropletSize = DigitalOceanDropletSize.LARGE;
        } else if (this.scraperCountPerWorkerNode <= 10) {
            this.autoDigitaloceanDropletSize =
                DigitalOceanDropletSize.LARGE_16G;
        } else {
            // default
            this.autoDigitaloceanDropletSize = DigitalOceanDropletSize.MEDIUM;
        }
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
