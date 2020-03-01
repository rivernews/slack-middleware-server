import { ServerError } from '../../utilities/serverExceptions';

// type guards in Typescript
// https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards

export enum ScraperJobMessageType {
    PREFLIGHT = 'preflight',
    PROGRESS = 'progress',
    FINISH = 'finish',
    ERROR = 'error'
}

export enum ScraperJobMessageTo {
    SLACK_MD_SVC = 'slackMiddlewareService',
    SCRAPER = 'scraper'
}

export type ScraperCrossRequestData = ScraperJobRequestData & {
    orgId: string;
    orgName: string;
    lastProgress: ScraperProgressData;
    lastReviewPage: string;
    scrapeMode: ScraperMode;
};

export interface ScraperProgressData {
    processed: number;
    wentThrough: number;
    total: number;
    durationInMilli: string;
    page: number;
    processedSession: number;
}

export class ScraperProgress {
    public static isScraperProgressData (
        props: any,
        throwError: boolean = false
    ): props is ScraperProgressData {
        if (
            !(
                typeof props.processed === 'number' &&
                typeof props.wentThrough === 'number' &&
                typeof props.total === 'number' &&
                typeof props.durationInMilli === 'string' &&
                typeof props.page === 'number' &&
                typeof props.processedSession === 'number'
            )
        ) {
            if (throwError) {
                throw new ServerError(
                    `Failed to validate ScraperCrossRequest instance, because required data is missing in props: ` +
                        JSON.stringify(props)
                );
            }

            return false;
        }

        return true;
    }
}

export enum ScraperMode {
    REGULAR = 'regular',
    RENEWAL = 'renewal'
}

// export type SupervisorJobRequestData = string | string[];
export interface SupervisorJobRequestData {
    orgInfo?: string;
    orgInfoList?: string[];
}

export interface ScraperJobRequestData {
    // for regular scraper job
    orgInfo?: string;

    // for renewal job
    orgId?: string;
    orgName?: string;
    lastProgress?: ScraperProgressData;
    lastReviewPage?: string;
    scrapeMode?: ScraperMode;
}

export class ScraperCrossRequest implements ScraperCrossRequestData {
    public orgId: string;
    public orgName: string;
    public lastProgress: ScraperProgressData;
    public lastReviewPage: string;
    public scrapeMode: ScraperMode;

    constructor (props: ScraperCrossRequestData) {
        ScraperCrossRequest.isScraperCrossRequestData(props, true);

        this.orgId = props.orgId;
        this.orgName = props.orgName;
        this.lastProgress = props.lastProgress;
        this.lastReviewPage = props.lastReviewPage;
        this.scrapeMode = props.scrapeMode;
    }

    // type guard in Typescript
    // https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards
    public static isScraperCrossRequestData (
        props: any,
        throwError: boolean = false
    ): props is ScraperCrossRequestData {
        if (
            !(
                props.orgId &&
                props.orgName &&
                props.lastProgress &&
                props.lastReviewPage &&
                props.scrapeMode
            )
        ) {
            if (throwError) {
                throw new ServerError(
                    `Failed to validate ScraperCrossRequest instance, because required data is missing in props: ` +
                        JSON.stringify(props)
                );
            }

            return false;
        }

        // also check for any class-object field
        ScraperProgress.isScraperProgressData(props.lastProgress, throwError);

        return true;
    }

    public static parseFromMessagePayloadString = (payloadString: string) => {
        const parsedData = JSON.parse(payloadString);
        return new ScraperCrossRequest(parsedData);
    };
}
