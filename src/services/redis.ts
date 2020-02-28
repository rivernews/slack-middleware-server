import { ServerError } from '../utilities/serverExceptions';
import { RuntimeEnvironment } from '../utilities/runtime';

// node-redis pubsub doc
// https://github.com/NodeRedis/node-redis#pubsub

if (
    !(
        process.env.REDIS_HOST &&
        process.env.REDIS_PORT &&
        process.env.SUPERVISOR_PUBSUB_REDIS_DB
    )
) {
    console.error(
        'Redis misconfigured. Here is all the env vars we have:',
        process.env
    );
    throw new ServerError('Redis misconfigured');
}

const REDIS_HOST: string = process.env.REDIS_HOST;
const REDIS_PORT: string = process.env.REDIS_PORT;
export const REDIS_DB: string = process.env.SUPERVISOR_PUBSUB_REDIS_DB;

if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
    console.debug('REDIS_HOST', REDIS_HOST);
    console.debug('REDIS_PORT', REDIS_PORT);
    console.debug('REDIS_DB', REDIS_DB);
}

const redisConnectionConfig = {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT),
    db: parseInt(REDIS_DB)
};

export const getRedisConnectionConfig = () => {
    return redisConnectionConfig;
};

export enum RedisPubSubChannelName {
    SCRAPER_JOB_CHANNEL = 'scraperJobChannel'
}
