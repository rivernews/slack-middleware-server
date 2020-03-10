import { ServerError } from '../utilities/serverExceptions';
import { RuntimeEnvironment } from '../utilities/runtime';
import { RedisClient, createClient } from 'redis';
import IORedis from 'ioredis';

// node-redis pubsub doc
// https://github.com/NodeRedis/node-redis#pubsub

export enum RedisPubSubChannelName {
    SCRAPER_JOB_CHANNEL = 'scraperJobChannel',
    ADMIN = 'scraperAdmin'
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
    }
}

export const redisManager = RedisManagerSingleton.singleton;

export class JobQueueSharedRedisClientsSingleton {
    private static _singleton = new JobQueueSharedRedisClientsSingleton();

    public genericClient?: IORedis.Redis;
    public subscriberClient?: IORedis.Redis;

    private processName: string = '';
    private redisIoClientsRecord: Array<IORedis.Redis> = [];

    private constructor () {}

    public intialize (processName: string) {
        this.processName = processName;

        if (!this.genericClient) {
            this.genericClient = this.newIORedisClient(
                `${processName} shared generic`
            );
        }

        if (!this.subscriberClient) {
            this.subscriberClient = this.newIORedisClient(
                `${processName} shared subscriber`
            );
        }
    }

    public static get singleton () {
        return JobQueueSharedRedisClientsSingleton._singleton;
    }

    // have to have a separate func since 'redis' and 'ioredis' libraries are not the same
    public newIORedisClient (callerName: string) {
        const newIoRedisClient = new IORedis(redisManager.config);
        this.redisIoClientsRecord.push(newIoRedisClient);
        console.log(
            `${callerName} in ${this.processName} process, shared redis: created ioredis client, total`,
            this.redisIoClientsRecord.length
        );

        return newIoRedisClient;
    }

    /**
     * Releasing (resetting) redis clients created by `Bull.Queue.createClient()` 'bclient' type.
     *
     * There's no need to reset shared `this.genericClient` and `this.subscriberClient`, which is used by 'client' and 'subscriber' type in `Bull.Queue.createClient()`.
     * Since there will always be a fixed total of 2 client instances per process, no memory leak in the long term. Don't reset them upon job finish / queue close as well, as they will be needed for establishing connection if Bull decides to reuse the sandbox process. When Bull decides to release sandbox process, they will be cleaned up along with the process as well.
     *
     * About redis connection clean up - as long as we are calling `Bull.Queue.close()`, Bull will handle all the clean up for us. Do not manually call client.quit() here, because Bull may want to reuse that client later; if you force such call, Bull will attempt to reconnect many times and cause memory pressure, causing the system to be unstable and killed / evicted.
     */
    public resetAllClientResources (callerName: string) {
        console.debug(
            `${callerName} in ${this.processName} process, shared redis: resetting additional ${this.redisIoClientsRecord.length} clients:`,
            this.redisIoClientsRecord
        );
        this.redisIoClientsRecord = [];
    }
}
