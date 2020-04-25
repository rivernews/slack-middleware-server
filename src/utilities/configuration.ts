export class Configuration {
    private static _singleton: Configuration;

    public gdReviewCountPerPage: number;
    public scraperJobSplittingSize: number;
    public crossSessionTimeLimitMinutes: number;

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
