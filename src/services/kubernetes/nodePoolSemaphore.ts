import { Configuration } from '../../utilities/configuration';
import { CustomSemaphore } from '../../utilities/customSemaphore';
import { RuntimeEnvironment } from '../../utilities/runtime';
import IORedis from 'ioredis';
import { JobQueueSharedRedisClientsSingleton } from '../redis';
import { IKubernetesClusterNodePool } from 'dots-wrapper/dist/modules/kubernetes';
import { asyncSendSlackMessage } from '../slack';

// redis data type (Lists)
// https://redis.io/topics/data-types

interface SemaphoreCollection {
    [key: string]: CustomSemaphore;
}

class NodePoolSemaphoreSingleton {
    private static _singleton: NodePoolSemaphoreSingleton;
    private constructor () {
        JobQueueSharedRedisClientsSingleton.singleton.intialize();
        if (!JobQueueSharedRedisClientsSingleton.singleton.genericClient) {
            throw new Error(
                'Failed to initialize shared redis client when constructing node pool semaphore'
            );
        }
        this.redisClient =
            JobQueueSharedRedisClientsSingleton.singleton.genericClient;
    }
    static get singleton () {
        if (!NodePoolSemaphoreSingleton._singleton) {
            NodePoolSemaphoreSingleton._singleton = new NodePoolSemaphoreSingleton();
        }

        return NodePoolSemaphoreSingleton._singleton;
    }

    private redisClient: IORedis.Redis;
    private static NODE_ID_STORE_KEY = 'k8NodeResourceLock-nodeIds';

    private sessionSemaphoreCollection?: SemaphoreCollection;

    private _storeNodeIdList (nodeIds: string[]) {
        return this.redisClient.sadd(
            NodePoolSemaphoreSingleton.NODE_ID_STORE_KEY,
            ...nodeIds
        );
    }
    private _retrieveNodeIdList () {
        return this.redisClient.smembers(
            NodePoolSemaphoreSingleton.NODE_ID_STORE_KEY
        );
    }
    private _nodeIdListSize () {
        return this.redisClient.scard(
            NodePoolSemaphoreSingleton.NODE_ID_STORE_KEY
        );
    }
    private _removeNodeIdList () {
        return this.redisClient.del(
            NodePoolSemaphoreSingleton.NODE_ID_STORE_KEY
        );
    }

    /**
     * This method should be called when node pool is created, but
     * can also be called when a check on node pool status is verified
     * @param nodeIds
     */
    private async _assignSemaphoreCollection (nodeIds: string[]) {
        console.log('assigning nodes to node pool semaphore', nodeIds);

        // store on redis
        await this._storeNodeIdList(nodeIds);
        const res = await this._retrieveNodeIdList();
        if (!res.length) {
            throw new Error(
                'Did not assign any node id on redis while assigning nodes for node pool semaphore. Did you input any node ids?'
            );
        }

        return res;
    }
    public asyncAssignSemaphoreCollection (
        nodePool: IKubernetesClusterNodePool
    ) {
        return this._assignSemaphoreCollection(
            nodePool.nodes.map(node => {
                if (!node.id) {
                    throw new Error(
                        `Node id missing, cannot setup node pool semaphore`
                    );
                }
                return node.id;
            })
        );
    }

    private async retrieveSemaphoreCollection () {
        // get from redis
        const nodeIds: string[] = await this._retrieveNodeIdList();

        const capacityPerNode =
            Configuration.singleton.scraperCountPerWorkerNode;

        const semaphoreCollection: SemaphoreCollection = {};
        for (const nodeId of nodeIds) {
            semaphoreCollection[nodeId] = new CustomSemaphore(
                this.getSemaphoreName(nodeId),
                capacityPerNode
            );
        }

        return semaphoreCollection;
    }

    /**
     * This method can be a quick simple way to check if previous node pool exists,
     */
    public get asyncGetSize () {
        return this._nodeIdListSize();
    }

    private getSemaphoreName (nodeId: string) {
        return `k8NodeResourceLock-${nodeId}`;
    }

    public async acquire () {
        // only one acquire-release session is allowed at a time for each sandbox process
        // forbid any new acquire() before previous semaphore is released
        // https://github.com/rivernews/slack-middleware-server/issues/62#issuecomment-629843810
        if (this.sessionSemaphoreCollection) {
            throw new Error(
                `You try to acquire a semaphore of node pool, but previous sessionSemaphoreCollection is not cleaned up. You need to release previous session's semaphore first.`
            );
        }

        const semaphoreCollection = await this.retrieveSemaphoreCollection();

        const nodeIds = Object.keys(semaphoreCollection);
        if (nodeIds.length === 0) {
            throw new Error(
                'No semaphore available while trying to acquire k8 node pool resources'
            );
        }

        for (const nodeId of nodeIds) {
            const semaphore = semaphoreCollection[nodeId];
            try {
                await semaphore.acquire();
                // acquire succeed, now store session semaphore object, which
                // should only be cleaned up by a following .release() or .reset()
                this.sessionSemaphoreCollection = semaphoreCollection;
                return nodeId;
            } catch (error) {}

            if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
                console.log('still acquiring a k8 node semaphore...');
            }
        }

        return;
    }

    public async release (nodeId: string) {
        // make sure there's a previous session created by acquire() in the same sandbox process
        // https://github.com/rivernews/slack-middleware-server/issues/62#issuecomment-629843810
        if (!this.sessionSemaphoreCollection) {
            throw new Error(
                'No sessionSemaphoreCollection while trying to release a semaphore of node pool. You need to make sure acquire() was executed in the same process as release()'
            );
        }

        const semaphoreCollection = this.sessionSemaphoreCollection;

        const releaseResult = await semaphoreCollection[nodeId].release();

        // allow the next acquire() to start a new session
        this.sessionSemaphoreCollection = undefined;

        try {
            await asyncSendSlackMessage(
                `🟢 PID ${process.pid}: Released semaphore for node id \`${nodeId}\``
            );
        } catch (error) {}
        console.log(
            `PID ${process.pid}: Released semaphore for node id \`${nodeId}\` `
        );

        return releaseResult;
    }

    /**
     * Call this method when node pool is teared down
     */
    public async reset () {
        // just for making sure each semaphore key is cleaned up in redis
        // this may be redundant since the last .release() may already be cleaning up the key
        const semaphoreCollection = await this.retrieveSemaphoreCollection();
        const deletedCounts: number[] = [];
        for (const nodeId of Object.keys(semaphoreCollection)) {
            const semaphore = semaphoreCollection[nodeId];
            try {
                const deletedCount = await semaphore.delete();
                deletedCounts.push(deletedCount);
            } catch (error) {
                throw error;
            }
        }

        deletedCounts.push(await this._removeNodeIdList());

        console.log('complete reset node pool semaphores', deletedCounts);

        // make sure local semaphore objects are flushed
        this.sessionSemaphoreCollection = undefined;

        return deletedCounts;
    }
}

export const NodePoolSemaphore = NodePoolSemaphoreSingleton.singleton;
export type NodePoolSemaphoreType = typeof NodePoolSemaphore;
