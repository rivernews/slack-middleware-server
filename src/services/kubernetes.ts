import {
    KubeConfig,
    BatchV1Api,
    V1Job,
    V1EnvVar
} from '@kubernetes/client-node';
import { Semaphore } from 'redis-semaphore';
import { createApiClient as createDigitalOceanClient } from 'dots-wrapper';
import { IKubernetesCluster } from 'dots-wrapper/dist/modules/kubernetes/types/kubernetes-cluster';
import { ScraperJobRequestData } from './jobQueue/types';
import { mapJobDataToScraperEnvVar } from './jobQueue/mapJobDataToScraperEnvVar';
import { redisManager, JobQueueSharedRedisClientsSingleton } from './redis';
import { s3ArchiveManager } from './s3';
import { RuntimeEnvironment } from '../utilities/runtime';
import { ServerError } from '../utilities/serverExceptions';
import { ICreateNodePoolApiRequest } from 'dots-wrapper/dist/modules/kubernetes';

// digitalocean client
// https://github.com/pjpimentel/dots

// kubernetes client
// https://github.com/kubernetes-client/javascript

const digitalOceanClientExample = createDigitalOceanClient({ token: '' });

export class KubernetesService {
    private static _singleton: KubernetesService;

    private static DIGITALOCEAN_KUBERNETES_CLUSTER_NAME =
        'project-shaungc-digitalocean-cluster';

    private static SCRAPER_WORKER_NODE_LABEL = 'scraper-worker-node';

    private static JOB_NAMESPACE = 'slack-middleware-service';

    private digitalOceanToken: string;
    private digitalOceanClient: typeof digitalOceanClientExample;

    private kubernetesConfig?: KubeConfig;
    private kubernetesCluster?: IKubernetesCluster;
    private kubernetesBatchClient?: BatchV1Api;

    public jobVacancySemaphore: Semaphore;

    private constructor () {
        if (!process.env.DIGITALOCEAN_ACCESS_TOKEN) {
            throw new Error('Digitalocean token not configured');
        }

        this.digitalOceanToken = process.env.DIGITALOCEAN_ACCESS_TOKEN;
        this.digitalOceanClient = createDigitalOceanClient({
            token: this.digitalOceanToken
        });

        JobQueueSharedRedisClientsSingleton.singleton.intialize('master');
        if (!JobQueueSharedRedisClientsSingleton.singleton.genericClient) {
            throw new ServerError(
                'KubernetesService:jobVacancySemaphore: Shared job queue redis client did not initialize'
            );
        }

        // Currently our k8 cluster is suitable for running up to 3 scraper job at most
        this.jobVacancySemaphore = new Semaphore(
            JobQueueSharedRedisClientsSingleton.singleton.genericClient,
            'k8JobResourceLock',
            parseInt(process.env.PLATFORM_CONCURRENCY_K8S || '3'),
            {
                // when k8 has no vacancy, this situation will be
                // detected after 6 sec when someone call `.acquire()`
                acquireTimeout: 20 * 1000,
                retryInterval: 5 * 1000,

                lockTimeout: 40 * 1000,
                refreshInterval: 20 * 1000
            }
        );
    }

    public static get singleton () {
        if (!KubernetesService._singleton) {
            KubernetesService._singleton = new KubernetesService();
        }

        return KubernetesService._singleton;
    }

    public async asyncInitialize () {
        console.log('asyncInitialize()');

        try {
            if (this.kubernetesBatchClient) {
                return;
            }

            // acquire kubernetes cluster credential first
            // similar to:
            // doctl kubernetes cluster kubeconfig show project-shaungc-digitalocean-cluster > kubeconfig.yaml

            let kubernetesClusters: IKubernetesCluster[] = [];

            const K8S_CHECK_CLUSTER_RETRY = 3;
            let k8sCheckClusterCounter = 0;
            while (k8sCheckClusterCounter < K8S_CHECK_CLUSTER_RETRY) {
                try {
                    let {
                        data: { kubernetes_clusters }
                    } = await this.digitalOceanClient.kubernetes.listKubernetesClusters(
                        {
                            page: 1,
                            per_page: 999
                        }
                    );

                    kubernetesClusters = kubernetes_clusters;
                    break;
                } catch (error) {
                    console.error(
                        error,
                        `\nRetried checking k8s cluster for times ${k8sCheckClusterCounter +
                            1}/${K8S_CHECK_CLUSTER_RETRY}`
                    );
                }
                k8sCheckClusterCounter++;
            }

            if (!kubernetesClusters.length) {
                throw new Error('No kubernetes clusters found');
            }

            const kubernetesCluster = kubernetesClusters.find(cluster => {
                return (
                    cluster.name ===
                    KubernetesService.DIGITALOCEAN_KUBERNETES_CLUSTER_NAME
                );
            });
            this.kubernetesCluster = kubernetesCluster;

            if (!kubernetesCluster) {
                throw new Error(
                    `No kubernetes cluster matches name '${KubernetesService.DIGITALOCEAN_KUBERNETES_CLUSTER_NAME}'`
                );
            }

            let kubeconfigString = '';
            try {
                const {
                    data: kubeconfig
                } = await this.digitalOceanClient.kubernetes.getKubernetesClusterKubeconfig(
                    {
                        kubernetes_cluster_id: kubernetesCluster.id
                    }
                );

                kubeconfigString = kubeconfig;
            } catch (error) {
                console.error(
                    `get kubeconfig from digitalocean failed, finding by id`,
                    kubernetesCluster.id
                );
                throw error;
            }

            this.kubernetesConfig = new KubeConfig();
            this.kubernetesConfig.loadFromString(kubeconfigString);

            this.kubernetesBatchClient = this.kubernetesConfig.makeApiClient(
                BatchV1Api
            );
        } catch (error) {
            console.error('error while initializing kubernetes client');
            throw error;
        }
    }

    private static getKubernetesEnvVarsFromEnvVarPairs (envVarPairs: {
        [key: string]: string;
    }) {
        return Object.keys(envVarPairs).map(envVarKey => {
            const envVarValue = envVarPairs[envVarKey];
            const kubernetesEnvVar = new V1EnvVar();
            kubernetesEnvVar.name = envVarKey;
            kubernetesEnvVar.value = envVarValue;
            return kubernetesEnvVar;
        }) as V1EnvVar[];
    }

    private createK8JobTemplate (jobData: ScraperJobRequestData) {
        if (
            !(
                process.env.GLASSDOOR_PASSWORD &&
                process.env.GLASSDOOR_USERNAME &&
                process.env.SLACK_TOKEN_INCOMING_URL &&
                process.env.SELENIUM_SERVER_HOST
            )
        ) {
            throw new Error('Job env var not configured');
        }

        // prepare job specs

        // create job request
        const job = new V1Job();
        job.metadata = {
            // must use lower case or hyphens
            name: `scraper-job-${Date.now()}`,
            namespace: KubernetesService.JOB_NAMESPACE
        };
        job.spec = {
            // do not retry job; if failed just fail permanently
            // we'll handle it in bull
            backoffLimit: 0,

            ...(process.env.NODE_ENV === RuntimeEnvironment.DEVELOPMENT
                ? {
                      ttlSecondsAfterFinished: 0
                  }
                : {
                      // preserve job log for up to 7 days (1 week)
                      ttlSecondsAfterFinished: 7 * 24 * 60
                  }),

            template: {
                spec: {
                    containers: [
                        {
                            name: 'scraper-job-container',
                            image: 'shaungc/gd-scraper:latest',
                            env: KubernetesService.getKubernetesEnvVarsFromEnvVarPairs(
                                {
                                    ...(mapJobDataToScraperEnvVar(jobData) as {
                                        [key: string]: string;
                                    }),

                                    SUPERVISOR_PUBSUB_REDIS_DB: redisManager.config.db.toString(),

                                    DIGITALOCEAN_ACCESS_TOKEN: this
                                        .digitalOceanToken,

                                    GLASSDOOR_USERNAME:
                                        process.env.GLASSDOOR_USERNAME,
                                    GLASSDOOR_PASSWORD:
                                        process.env.GLASSDOOR_PASSWORD,

                                    AWS_ACCESS_KEY_ID:
                                        s3ArchiveManager.accessKeyId,
                                    AWS_SECRET_ACCESS_KEY:
                                        s3ArchiveManager.secretAccessKey,
                                    AWS_REGION: s3ArchiveManager.bucketRegion,
                                    AWS_S3_ARCHIVE_BUCKET_NAME:
                                        s3ArchiveManager.bucketName,

                                    SLACK_WEBHOOK_URL:
                                        process.env.SLACK_TOKEN_INCOMING_URL,

                                    DEBUG: 'false',

                                    // use our selenium server container in this job
                                    WEBDRIVER_MODE: 'serverFromCustomHost',
                                    SELENIUM_SERVER_CUSTOM_HOST:
                                        process.env.SELENIUM_SERVER_HOST,

                                    REDIS_MODE: 'serverFromCustomHost',
                                    REDIS_CUSTOM_HOST:
                                        process.env.NODE_ENV ===
                                        RuntimeEnvironment.DEVELOPMENT
                                            ? process.env
                                                  .REDIS_HOST_ON_KUBERNETES ||
                                              ''
                                            : redisManager.config.host,
                                    REDIS_PASSWORD:
                                        process.env.REDIS_PASSWORD || ''
                                }
                            )
                        }
                    ],
                    restartPolicy: 'Never'
                }
            }
        };

        return job;
    }

    public async asyncAddScraperJob (jobData: ScraperJobRequestData) {
        await this.asyncInitialize();
        if (!this.kubernetesBatchClient) {
            throw new Error('kubernetesBatchClient not initialized yet');
        }

        // create k8 job
        const k8JobTemplate = this.createK8JobTemplate(jobData);

        try {
            const k8Job = await this.kubernetesBatchClient.createNamespacedJob(
                KubernetesService.JOB_NAMESPACE,
                k8JobTemplate
            );
            return k8Job;
        } catch (error) {
            // maybe digitalocean rotated (updated) kubernetes credentials, so we need to re-initialize kubernetes client
            if (error && error.response && error.response.statusCode === 401) {
                this.kubernetesBatchClient = undefined;
                await this.asyncInitialize();
                if (!this.kubernetesBatchClient) {
                    throw new Error(
                        'kubernetesBatchClient not initialized yet'
                    );
                }

                const k8Job = await (this
                    .kubernetesBatchClient as BatchV1Api).createNamespacedJob(
                    KubernetesService.JOB_NAMESPACE,
                    k8JobTemplate
                );

                return k8Job;
            }

            throw error;
        }
    }

    public async _createScraperWorkerNodePool () {
        console.log('create node pool()');

        await this.asyncInitialize();
        if (!this.kubernetesCluster?.id) {
            throw new Error('Kubernetes cluster not initialized yet');
        }

        const nodeRequest: ICreateNodePoolApiRequest = {
            kubernetes_cluster_id: this.kubernetesCluster.id,
            name: 'scraper-worker-node-' + Date.now(),

            count: 1,
            auto_scale: false,

            // see all droplet size slugs at
            // https://developers.digitalocean.com/documentation/changelog/api-v2/new-size-slugs-for-droplet-plan-changes/
            size: 's-4vcpu-8gb',
            tags: [KubernetesService.SCRAPER_WORKER_NODE_LABEL]
        };

        const {
            data: { node_pool }
        } = await this.digitalOceanClient.kubernetes.createNodePool(
            nodeRequest
        );

        return node_pool;
    }

    public async _listScraperWorkerNodePool () {
        console.log('list node pools()');

        await this.asyncInitialize();
        if (!this.kubernetesCluster?.id) {
            throw new Error('Kubernetes cluster not initialized yet');
        }

        const {
            data: { node_pools }
        } = await this.digitalOceanClient.kubernetes.listNodePools({
            kubernetes_cluster_id: this.kubernetesCluster.id,
            page: 9999,
            per_page: 25
        });

        return node_pools.filter(nodePool =>
            nodePool.tags.includes(KubernetesService.SCRAPER_WORKER_NODE_LABEL)
        );
    }

    public async _cleanScraperWorkerNodePools () {
        console.log('clean node pools()');

        await this.asyncInitialize();
        if (!this.kubernetesCluster?.id) {
            throw new Error('Kubernetes cluster not initialized yet');
        }

        const allScraperWorkerNodePools = await this._listScraperWorkerNodePool();
        for (let nodePool of allScraperWorkerNodePools) {
            const result = await this.digitalOceanClient.kubernetes.deleteNodePool(
                {
                    kubernetes_cluster_id: this.kubernetesCluster.id,
                    node_pool_id: nodePool.id
                }
            );

            console.log('delete status for node pool', nodePool.name, result);
        }
    }
}
