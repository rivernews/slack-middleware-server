export class Configuration {
    private static _singleton: Configuration;

    public gdReviewCountPerPage: number;
    public scraperJobSplittingSize: number;

    private constructor () {
        this.gdReviewCountPerPage = this._getNumberFromEnvVar(
            'GLASSDOOR_REVIEW_COUNT_PER_PAGE',
            '10'
        );

        this.scraperJobSplittingSize = this._getNumberFromEnvVar(
            'SCRAPER_JOB_SPLITTING_SIZE',
            '1500'
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
