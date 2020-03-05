import Bull = require('bull');
import { s3ArchiveManager } from '../../services/s3';
import { supervisorJobQueueManager } from '../supervisorJob/queue';
import { s3OrgsJobQueueManager } from './queue';
import { SUPERVISOR_JOB_CONCURRENCY } from '../../services/jobQueue';

const getOrgListFromS3 = async () => {
    return s3ArchiveManager.asyncGetOverviewPageUrls();

    // return [
    //     'https://www.glassdoor.com/Overview/Working-at-Palo-Alto-Networks-EI_IE115142.11,29.htm'
    // ];

    // return [
    //     'healthcrowd',
    //     'https://www.glassdoor.com/Overview/Working-at-Pinterest-EI_IE503467.11,20.htm',
    // ];
    // return ['"Palo Alto Network"'];
    // return [];
    // return ['healthcrowd'];
};

module.exports = function (s3OrgsJob: Bull.Job<null>) {
    return (
        s3OrgsJobQueueManager
            .checkConcurrency(
                SUPERVISOR_JOB_CONCURRENCY,
                supervisorJobQueueManager.queue,
                s3OrgsJob
            )
            .then(() => getOrgListFromS3())
            // increment progress after s3 org list fetched
            .then(orgInfoList =>
                s3OrgsJob.progress(s3OrgsJob.progress() + 1).then(() =>
                    supervisorJobQueueManager.queue.add({
                        orgInfoList
                    })
                )
            )
            // increment progress after job dispatched
            .then(supervisorJob =>
                s3OrgsJob
                    .progress(s3OrgsJob.progress() + 1)
                    .then(() => supervisorJob.finished())
            )
            // increment progress after job finished
            .then(result =>
                s3OrgsJob
                    .progress(s3OrgsJob.progress() + 1)
                    .then(() => Promise.resolve(result))
            )
            .catch(error => {
                return Promise.reject(error);
            })
    );
};
