import { ServerError } from '../utilities/serverExceptions';
import { RuntimeEnvironment } from '../utilities/runtime';

// node-redis pubsub doc
// https://github.com/NodeRedis/node-redis#pubsub

if (
    !(process.env.REDIS_HOST && process.env.REDIS_PORT && process.env.REDIS_DB)
) {
    throw new ServerError('Redis misconfigured');
}

const REDIS_HOST: string = process.env.REDIS_HOST;
const REDIS_PORT: string = process.env.REDIS_PORT;
const REDIS_DB: string = process.env.REDIS_DB;

if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
    console.debug('REDIS_HOST', REDIS_HOST);
    console.debug('REDIS_PORT', REDIS_PORT);
    console.debug('REDIS_DB', REDIS_DB);
}

export const redisConnectionConfig = {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT),
    db: parseInt(REDIS_DB)
};

export enum RedisPubSubChannelName {
    SCRAPER_JOB_CHANNEL = 'scraperJobChannel'
}
