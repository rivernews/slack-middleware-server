import Bull = require('bull');
import { s3ArchiveManager } from '../../services/s3';
import { supervisorJobQueue } from '../supervisorJob/queue';

const getOrgListFromS3 = async () => {
    // return s3ArchiveManager.asyncGetOverviewPageUrls();

    // return [
    //     'https://www.glassdoor.com/Overview/Working-at-Palo-Alto-Networks-EI_IE115142.11,29.htm'
    // ];

    // return [
    //     'healthcrowd',
    //     'https://www.glassdoor.com/Overview/Working-at-Pinterest-EI_IE503467.11,20.htm',
    // ];
    // return ['"Palo Alto Network"'];
    return [];
    // return ['healthcrowd'];
};

module.exports = function (s3OrgsJob: Bull.Job<null>) {
    getOrgListFromS3()
        .then(orgInfoList => {
            return supervisorJobQueue.add(orgInfoList);
        })
        .then(supervisorJob => {
            return supervisorJob.finished();
        })
        .then(result => {
            Promise.resolve(result);
        })
        .catch(error => {
            return Promise.reject(error);
        });
};
