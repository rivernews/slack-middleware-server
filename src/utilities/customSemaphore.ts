import { Semaphore } from 'redis-semaphore';
import { JobQueueSharedRedisClientsSingleton } from '../services/redis';
import IORedis from 'ioredis';
import { RuntimeEnvironment } from './runtime';

export class CustomSemaphore extends Semaphore {
    private redisClient: IORedis.Redis;

    private semaphoreName: string;

    constructor (semaphoreName: string, limit: number) {
        JobQueueSharedRedisClientsSingleton.singleton.intialize();
        if (!JobQueueSharedRedisClientsSingleton.singleton.genericClient) {
            throw new Error(
                'Cannot initialize shared redis client when initializing custom semaphore'
            );
        }
        const redisClient =
            JobQueueSharedRedisClientsSingleton.singleton.genericClient;

        super(redisClient, semaphoreName, limit, {
            // the overall time to attempt to acquire a space
            acquireTimeout: 5 * 1000, // default 10s

            // if one acquire attempt failed, the interval to retry
            retryInterval: 0.5 * 1000, // default 10ms

            // once acquired semaphore, how long does it stay w/o release()
            lockTimeout: 10 * 60 * 1000, // default 10s
            refreshInterval: 60 * 1000
        });

        this.redisClient = redisClient;
        this.semaphoreName = semaphoreName;
    }

    public get key () {
        return `semaphore:${this.semaphoreName}`;
    }

    public async delete () {
        console.log('deleting semaphore ' + this.semaphoreName);
        return await this.redisClient.del(this.key);
    }
}
