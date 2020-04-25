interface S3Org {
    companyOverviewPageUrl: string;
    reviewPageUrl: string;
    localReviewCount: number;

    orgId: string;
    orgName: string;
}

export class S3Organization implements S3Org {
    public companyOverviewPageUrl: string;
    public reviewPageUrl: string;
    public localReviewCount: number;

    public orgId: string;
    public orgName: string;

    constructor (props: S3Org) {
        this.companyOverviewPageUrl = props.companyOverviewPageUrl;
        this.reviewPageUrl = props.reviewPageUrl;
        this.localReviewCount = props.localReviewCount;

        this.orgId = props.orgId;
        this.orgName = props.orgName;
    }
}
