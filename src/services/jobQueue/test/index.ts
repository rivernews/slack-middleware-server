import Bull = require('bull');
import { redisConnectionConfig } from '../../redis';
import { createClient } from 'redis';
import path from 'path';

const adminClient = createClient(redisConnectionConfig);
adminClient.flushdb();

// cronjob/queue.ts
export const cronjobQueue = new Bull<any>('cronjobQueue', {
    redis: redisConnectionConfig
});

cronjobQueue.process(1, path.join(__dirname, './cronjob.process.ts'));

// entry point
cronjobQueue.add({});
console.log('added cronjob');

// scraperJob/queue.ts
export const scraperJobQueue = new Bull<number>('scraperJobQueue', {
    redis: redisConnectionConfig
});

scraperJobQueue.process(1, path.join(__dirname, './scraperJob.process.ts'));

scraperJobQueue.on('completed', (job, result) => {
    console.log(`job ${job.id} completed, result:`, result);
});

scraperJobQueue.on('active', job => {
    console.log(`job ${job.id} active`);
});
