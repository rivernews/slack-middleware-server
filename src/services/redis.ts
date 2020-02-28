import { ServerError } from '../utilities/serverExceptions';
import { RuntimeEnvironment } from '../utilities/runtime';

// node-redis pubsub doc
// https://github.com/NodeRedis/node-redis#pubsub

export enum RedisPubSubChannelName {
    SCRAPER_JOB_CHANNEL = 'scraperJobChannel'
}

// creating a singleton
// https://stackoverflow.com/a/54351936/9814131

class RedisConfig {
    public constructor (
        public host: string,
        public port: number,
        public db: number
    ) {}
}

class RedisManager {
    private static _singleton = new RedisManager();

    public config: RedisConfig;

    private constructor () {
        if (
            !(
                process.env.REDIS_HOST &&
                process.env.REDIS_PORT &&
                process.env.SUPERVISOR_PUBSUB_REDIS_DB
            )
        ) {
            throw new ServerError(
                'Redis misconfigured. Make sure you have these env vars: REDIS_HOST, REDIS_PORT, SUPERVISOR_PUBSUB_REDIS_DB'
            );
        }

        this.config = {
            host: process.env.REDIS_HOST,
            port: parseInt(process.env.REDIS_PORT),
            db: parseInt(process.env.SUPERVISOR_PUBSUB_REDIS_DB)
        };

        if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
            console.debug('redis config', this.config);
        }
    }

    public static get singleton () {
        return this._singleton;
    }
}

export const redisManager = RedisManager.singleton;
