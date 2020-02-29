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
    procressed: number;
    wentThrough: number;
    total: number;
    durationInMilli: string;
    page: number;
    processedSession: number;
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
                    `Failed to create ScraperCrossRequest instance, because required data is missing in props: ` +
                        JSON.stringify(props)
                );
            }

            return false;
        }

        return true;
    }

    public static parseFromMessagePayloadString = (payloadString: string) => {
        const parsedData = JSON.parse(payloadString);
        return new ScraperCrossRequest(parsedData);
    };
}
