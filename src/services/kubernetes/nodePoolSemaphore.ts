import { Configuration } from '../../utilities/configuration';
import { CustomSemaphore } from '../../utilities/semaphore';
import { RuntimeEnvironment } from '../../utilities/runtime';

class NodePoolSemaphoreSingleton {
    private static _singleton: NodePoolSemaphoreSingleton;
    private constructor () {
        this.semaphoreCollection = {};
    }
    static get singleton () {
        if (!NodePoolSemaphoreSingleton._singleton) {
            NodePoolSemaphoreSingleton._singleton = new NodePoolSemaphoreSingleton();
        }

        return NodePoolSemaphoreSingleton._singleton;
    }

    private semaphoreCollection: { [key: string]: CustomSemaphore };

    public assignNodes (nodeIds: string[]) {
        const capacityPerNode =
            Configuration.singleton.scraperCountPerWorkerNode;

        for (const nodeId of nodeIds) {
            this.semaphoreCollection[nodeId] = new CustomSemaphore(
                this.getSemaphoreName(nodeId),
                capacityPerNode
            );
        }
    }

    public get size () {
        return Object.keys(this.semaphoreCollection).length;
    }

    private getSemaphoreName (nodeId: string) {
        return `k8NodeResourceLock-${nodeId}`;
    }

    public async acquire () {
        for (const nodeId of Object.keys(this.semaphoreCollection)) {
            const semaphore = this.semaphoreCollection[nodeId];
            try {
                await semaphore.acquire();
                return nodeId;
            } catch (error) {}

            if (process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT) {
                console.log('still acquiring a k8 node semaphore...');
            }
        }

        return;
    }

    public async release (nodeId: string) {
        return await this.semaphoreCollection[nodeId].release();
    }

    public async reset () {
        const deletedCounts: number[] = [];
        for (const nodeId of Object.keys(this.semaphoreCollection)) {
            const semaphore = this.semaphoreCollection[nodeId];
            try {
                const deletedCount = await semaphore.delete();
                deletedCounts.push(deletedCount);
            } catch (error) {
                throw error;
            }
        }
        console.log('complete reset node pool semaphores', deletedCounts);
        this.semaphoreCollection = {};
    }
}

export const NodePoolSemaphore = NodePoolSemaphoreSingleton.singleton;
export type NodePoolSemaphoreType = typeof NodePoolSemaphore;
