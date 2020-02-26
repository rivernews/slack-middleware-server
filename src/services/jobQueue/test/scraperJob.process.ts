import Bull from 'bull';

// scraperJob/process.ts

module.exports = function (job: Bull.Job) {
    console.log(`started job ${job.id}`);
    return new Promise((resolve, reject) => {
        console.log(`processing job ${job.id} async part`);
        try {
            setTimeout(() => {
                resolve('times up!');
            }, 7000);
        } catch (error) {
            reject(error);
        }
    });
};
