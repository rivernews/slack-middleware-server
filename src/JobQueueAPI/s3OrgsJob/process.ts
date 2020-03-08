import Bull from 'bull';
import { s3ArchiveManager } from '../../services/s3';
import { supervisorJobQueueManager } from '../supervisorJob/queue';
import { s3OrgsJobQueueManager } from './queue';
import { ProgressBarManager } from '../../services/jobQueue/ProgressBar';
import { JobQueueName } from '../../services/jobQueue/jobQueueName';
import {
    SUPERVISOR_JOB_CONCURRENCY,
    cleanupJobQueuesAndRedisClients
} from '../../services/jobQueue';
import { ServerError } from '../../utilities/serverExceptions';

module.exports = function (s3OrgsJob: Bull.Job<null>) {
    console.log(`s3OrgsJob ${s3OrgsJob.id} started`, s3OrgsJob);

    supervisorJobQueueManager.initialize();
    const supervisorJobQueueManagerQueue = supervisorJobQueueManager.queue;
    if (!supervisorJobQueueManagerQueue) {
        throw new ServerError(
            `supervisorJobQueueManager queue not initialized yet`
        );
    }

    const progressBar = new ProgressBarManager(
        JobQueueName.GD_ORG_REVIEW_S3_ORGS_JOB,
        s3OrgsJob
    );

    return s3OrgsJobQueueManager
        .checkConcurrency(
            // check supervisor job is clean, no existing job
            // since s3 org job could provision lots of supervisor jobs and scraper jobs
            // it could be chaotic to mix s3 job with existing single org job
            // better to limit s3 job to launch only if no supervisor job exists
            1,
            supervisorJobQueueManagerQueue,
            s3OrgsJob
        )
        .then(supervisorJobsPresentCount => {
            // dispatch supervisors into parallel groups
            const VACANCY_BUFFER = 1;
            const supervisorJobVacancy =
                SUPERVISOR_JOB_CONCURRENCY -
                supervisorJobsPresentCount -
                VACANCY_BUFFER;
            return (
                s3ArchiveManager
                    .asyncGetOverviewPageUrls()
                    // increment progress after s3 org list fetched
                    .then(orgInfoList =>
                        progressBar
                            .increment()
                            // we have to use `orgInfoList` so need to nest callbacks in then() instead of chaining them
                            .then(() => {
                                const orgInfoListBucket: Array<Array<
                                    string
                                >> = [];

                                // safe in terms of ensuring `orgInfoListBucket.length` not exceeding concurrency vacancy
                                const chunkSizeSafeUpperBound = Math.ceil(
                                    orgInfoList.length / supervisorJobVacancy
                                );
                                for (
                                    let index = 0;
                                    index < orgInfoList.length;
                                    index += chunkSizeSafeUpperBound
                                ) {
                                    orgInfoListBucket.push(
                                        orgInfoList.slice(
                                            index,
                                            index + chunkSizeSafeUpperBound
                                        )
                                    );
                                }

                                // TODO: remove
                                console.debug(
                                    'orgInfoListBucket',
                                    orgInfoListBucket
                                );

                                progressBar.setRelativePercentage(
                                    0,
                                    supervisorJobVacancy
                                );

                                return Promise.all(
                                    orgInfoListBucket.map(bucketedOrgInfoList =>
                                        supervisorJobQueueManagerQueue.add({
                                            orgInfoList: bucketedOrgInfoList
                                        })
                                    )
                                );
                            })
                    )
                    .then(supervisorJobList =>
                        Promise.all(
                            supervisorJobList.map(supervisorJob =>
                                supervisorJob
                                    .finished()
                                    // increment progress after job finished, then propogate back job result
                                    .then(result =>
                                        progressBar
                                            .increment()
                                            .then(() => result)
                                    )
                            )
                        )
                    )
            );
        })
        .then(resultList => Promise.resolve(resultList))
        .catch(error => Promise.reject(error))
        .finally(() => cleanupJobQueuesAndRedisClients());
};