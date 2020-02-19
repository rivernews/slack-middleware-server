import { ServerError } from '../../utilities/serverUtilities';
import IORedis from 'ioredis';

if (
    !(process.env.REDIS_HOST && process.env.REDIS_PORT && process.env.REDIS_DB)
) {
    throw new ServerError('Redis misconfigured');
}

const REDIS_HOST: string = process.env.REDIS_HOST;
const REDIS_PORT: string = process.env.REDIS_PORT;
const REDIS_DB: string = process.env.REDIS_DB;

if (process.env.NODE_ENV === 'development') {
    console.debug('REDIS_HOST', REDIS_HOST);
    console.debug('REDIS_PORT', REDIS_PORT);
    console.debug('REDIS_DB', REDIS_DB);
}

export const redisConnectionConfig: IORedis.RedisOptions = {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT),
    db: parseInt(REDIS_DB)
};
