export enum JobQueueName {
    GD_ORG_REVIEW_S3_ORGS_JOB = 's3OrgsJob',
    GD_ORG_REVIEW_SUPERVISOR_JOB = 'supervisorJob',
    GD_ORG_REVIEW_SCRAPER_JOB = 'scraperJob'
}

export const getProssesorName = (jobQueueName: JobQueueName) => {
    return `${jobQueueName}Processor`;
};
