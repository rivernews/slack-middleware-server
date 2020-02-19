import Bull = require('bull');

import { redisConnectionConfig } from './redis';

export const cronjobQueue = new Bull('cronjobs', {
    redis: redisConnectionConfig
});

interface CronJobProps {
    scheduler: string;
    data: any;
}

export class CronJob {
    scheduler: string = '';
    data: any = {};

    constructor ({ scheduler, data }: CronJobProps) {
        this.scheduler = scheduler;
        this.data = data;
    }
}

// consumer (aka job handler)
cronjobQueue.process(async (job, done) => {
    console.log('consumer! process()');
    console.log(job.id);
    console.log('sleeping 3 sec');
    await new Promise(resolve => setTimeout(resolve, 3000));
    job.progress(20);

    console.log('sleeping 2 sec');
    await new Promise(resolve => setTimeout(resolve, 2000));
    job.progress(80);

    done(null, {
        message: 'success'
    });
});

// progress reporter
cronjobQueue.on('progress', async (job, progress) => {
    console.log('progress');
    console.log(progress);
});

// completion reporter
cronjobQueue.on('completed', async (job, result) => {
    console.log('completed');
    console.log(result);
});
