import { ServerError } from '../utilities/serverExceptions';
import { RuntimeEnvironment } from '../utilities/runtime';
import { RedisClient, createClient } from 'redis';
import IORedis from 'ioredis';

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

class RedisManagerSingleton {
    private static _singleton = new RedisManagerSingleton();

    public config: RedisConfig;

    private clients: Array<RedisClient> = [];
    private redisIoClients: Array<IORedis.Redis> = [];

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

    public newClient () {
        const newRedisClient = createClient(this.config);
        this.clients.push(newRedisClient);
        console.log('created redis client, total', this.clients.length);
        return newRedisClient;
    }

    // have to have a separate func since 'redis' and 'ioredis'
    // are not
    public newIORedisClient () {
        const newIoRedisClient = new IORedis(this.config);
        this.redisIoClients.push(newIoRedisClient);
        console.log(
            'created ioredis client, total',
            this.redisIoClients.length
        );
        return newIoRedisClient;
    }

    private static asyncCloseClient (client: RedisClient) {
        // expect client to be closed within 10 sec
        const closeClientProcessTimeout = 10 * 1000;
        return new Promise<string>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                return reject('Timed out while trying to close redis client');
            }, closeClientProcessTimeout);

            client.quit(error => {
                if (error) {
                    return reject(
                        `client failed to close + ${JSON.stringify(error)}`
                    );
                }

                clearTimeout(timeoutHandle);
                return resolve('OK');
            });
        });
    }

    public async asyncCloseAllClients () {
        // will continue even if client is already close
        // but at the end we'll be confident that all clients are closed
        for (const client of this.clients) {
            console.debug('closing redis client');
            await RedisManagerSingleton.asyncCloseClient(client);
        }

        for (const redisIoClient of this.redisIoClients) {
            console.debug('closing ioredis client');
            redisIoClient.disconnect();
        }
    }
}

export const redisManager = RedisManagerSingleton.singleton;

export class JobQueueSharedRedisClientsSingleton {
    private static _singleton = new JobQueueSharedRedisClientsSingleton();

    public genericClient?: IORedis.Redis;
    public subscriberClient?: IORedis.Redis;

    private constructor () {}

    public intialize () {
        if (!this.genericClient) {
            this.genericClient = redisManager.newIORedisClient();
        }

        if (!this.subscriberClient) {
            this.subscriberClient = redisManager.newIORedisClient();
        }
    }

    public static get singleton () {
        return JobQueueSharedRedisClientsSingleton._singleton;
    }
}
