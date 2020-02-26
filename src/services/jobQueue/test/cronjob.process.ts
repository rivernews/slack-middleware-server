import { scraperJobQueue } from '.';
import Bull = require('bull');

module.exports = function (job: Bull.Job) {
    console.log(`started cronjob ${job.id}`);

    return Promise.all([
        scraperJobQueue.getWaitingCount(),
        scraperJobQueue.getDelayedCount(),
        scraperJobQueue.getPausedCount(),
        scraperJobQueue.getActiveCount()
    ])
        .then(([waiting, delayed, paused, active]) => {
            console.log(`processing cronjob ${job.id} async part`);
            if (waiting || delayed || paused || active) {
                return Promise.reject('cronjob skip');
            }
            return Promise.resolve();
        })
        .then(async () => {
            const orgList = [1, 2];
            for (const org of orgList) {
                const job = await scraperJobQueue.add(org);

                console.log(`added scraper job ${job.id}`);
            }
            return Promise.resolve('OK');
        })
        .catch(error => Promise.reject(error));
};
