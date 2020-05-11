import {
    KubeConfig,
    BatchV1Api,
    V1Job,
    V1EnvVar,
    CoreV1Api,
    AppsV1Api,
    V1Container,
    V1Volume,
    V1VolumeMount
} from '@kubernetes/client-node';
import { Semaphore } from 'redis-semaphore';
import { createApiClient as createDigitalOceanClient } from 'dots-wrapper';
import { IKubernetesCluster } from 'dots-wrapper/dist/modules/kubernetes/types/kubernetes-cluster';
import { ScraperJobRequestData } from '../jobQueue/types';
import { mapJobDataToScraperEnvVar } from '../jobQueue/mapJobDataToScraperEnvVar';
import { redisManager, JobQueueSharedRedisClientsSingleton } from '../redis';
import { s3ArchiveManager } from '../s3';
import { RuntimeEnvironment } from '../../utilities/runtime';
import { ServerError } from '../../utilities/serverExceptions';
import {
    ICreateNodePoolApiRequest,
    IKubernetesClusterNodePool,
    DeleteNodePoolResponse
} from 'dots-wrapper/dist/modules/kubernetes';
import {
    DigitalOceanDropletSize,
    NodePoolGroupTypes,
    SeleniumArchitectureType
} from './types';
import { Configuration } from '../../utilities/configuration';

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

    public static SCRAPER_WORK_NAMESPACE = 'selenium-service';
    public static JOB_NAMESPACE = KubernetesService.SCRAPER_WORK_NAMESPACE;

    private digitalOceanToken: string;
    private digitalOceanClient: typeof digitalOceanClientExample;

    private kubernetesConfig?: KubeConfig;
    private kubernetesCluster?: IKubernetesCluster;

    public kubernetesBatchClient?: BatchV1Api;
    public kubernetesCoreClient?: CoreV1Api;
    public kubernetesAppClient?: AppsV1Api;

    public jobVacancySemaphore?: Semaphore;

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
        this.jobVacancySemaphore =
            Configuration.singleton.k8sJobConcurrency > 0
                ? new Semaphore(
                      JobQueueSharedRedisClientsSingleton.singleton.genericClient,
                      'k8JobResourceLock',
                      Configuration.singleton.k8sJobConcurrency,
                      {
                          // when k8 has no vacancy, this situation will be
                          // detected after 6 sec when someone call `.acquire()`
                          acquireTimeout: 20 * 1000,
                          retryInterval: 5 * 1000,

                          lockTimeout: 40 * 1000,
                          refreshInterval: 20 * 1000
                      }
                  )
                : undefined;
    }

    public static get singleton () {
        if (!KubernetesService._singleton) {
            KubernetesService._singleton = new KubernetesService();
        }

        return KubernetesService._singleton;
    }

    public async asyncInitialize (forceInitialize: boolean = false) {
        try {
            if (
                !forceInitialize &&
                this.kubernetesBatchClient &&
                this.kubernetesCoreClient &&
                this.kubernetesAppClient
            ) {
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
            this.kubernetesCoreClient = this.kubernetesConfig.makeApiClient(
                CoreV1Api
            );
            this.kubernetesAppClient = this.kubernetesConfig.makeApiClient(
                AppsV1Api
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

    private createK8JobTemplate (
        jobData: ScraperJobRequestData,
        nodePoolName: string
    ) {
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

        const additionalVolumes: V1Volume[] = [
            // how to create temp share volume between containers
            // https://www.alibabacloud.com/blog/kubernetes-volume-basics-emptydir-and-persistentvolume_594834
            {
                name: 'scraper-job-share',
                emptyDir: {}
            }
        ];

        const getAdditionalVolumeMounts: (
            readOnly: boolean
        ) => V1VolumeMount[] = readOnly => {
            return [
                {
                    name: additionalVolumes[0].name,
                    mountPath: '/tmp/scraper-job-share',
                    readOnly
                }
            ];
        };

        const additionalContainers: V1Container[] = [];

        console.log(
            'selenium archi type is',
            Configuration.singleton.seleniumArchitectureType
        );
        if (
            Configuration.singleton.seleniumArchitectureType ===
            SeleniumArchitectureType['pod-standalone']
        ) {
            console.log('adding standalone selenium ...');
            additionalContainers.push({
                name: `selenium-container`,
                // TODO: remove this
                // image: 'selenium/standalone-chrome:latest',
                image: 'shaungc/gd-selenium-standalone:latest',
                imagePullPolicy: 'Always',
                ports: [
                    {
                        name: 'port-4444',
                        containerPort: 4444
                    }
                ],
                volumeMounts: [
                    {
                        name: 'share-host-memory',
                        mountPath: '/dev/shm'
                    },
                    ...getAdditionalVolumeMounts(true)
                ],
                resources: {
                    limits: {
                        memory: '1200Mi',
                        cpu: Configuration.singleton.scraperDriverNodeCpuLimit
                    },
                    requests: {
                        memory: '200Mi',
                        cpu: '.1'
                    }
                },
                env: [
                    {
                        name: 'START_XVFB',
                        value: 'false'
                    }
                ]
                // TODO: wait if we want probe (it may kill container), else remove probe stuff
                // readinessProbe: healthProbe,
                // livenessProbe: healthProbe
            });

            additionalVolumes.push({
                name: 'share-host-memory',
                emptyDir: {
                    medium: 'Memory'
                }
            });
        }

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
                    nodeSelector: {
                        // use node selector to assign job to node
                        // https://www.digitalocean.com/community/questions/do-kubernetes-node-pool-tags-not-added-to-nodes-in-cluster
                        'doks.digitalocean.com/node-pool': nodePoolName
                    },
                    containers: [
                        {
                            name: 'scraper-job-container',
                            image: 'shaungc/gd-scraper:latest',
                            volumeMounts: [...getAdditionalVolumeMounts(false)],
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

                                    DEBUG: 'true',

                                    // use our selenium server container in this job
                                    WEBDRIVER_MODE: 'serverFromCustomHost',
                                    SELENIUM_SERVER_CUSTOM_HOST:
                                        Configuration.singleton
                                            .seleniumArchitectureType ===
                                        SeleniumArchitectureType['hub-node']
                                            ? process.env.SELENIUM_SERVER_HOST
                                            : // when accessing selenium in neighbor container of same job, use `localhost` to communicate
                                              // https://kubernetes.io/docs/tasks/access-application-cluster/communicate-containers-same-pod-shared-volume/#discussion
                                              'localhost',

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
                        },
                        ...additionalContainers
                    ],
                    restartPolicy: 'Never',
                    volumes: [...additionalVolumes]
                }
            }
        };

        return job;
    }

    public async asyncAddScraperJob (jobData: ScraperJobRequestData) {
        // check required resource

        await this.asyncInitialize();
        if (!this.kubernetesBatchClient) {
            throw new Error('kubernetesBatchClient not initialized yet');
        }

        const readyNodePool = await this.getReadyNodePool('scraperWorker');
        if (!readyNodePool) {
            throw new Error(`No ready node while adding k8s job`);
        }

        // create k8 job
        const k8JobTemplate = this.createK8JobTemplate(
            jobData,
            readyNodePool.name
        );

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

    // CRUD Node Operation - Digitalocean API
    // https://developers.digitalocean.com/documentation/v2/#add-a-node-pool-to-a-kubernetes-cluster
    // Nodejs client doc:
    // https://github.com/pjpimentel/dots/blob/master/src/modules/kubernetes/README.md#create-node-pool

    public async _createScraperWorkerNodePool (
        digitaloceanDropletSize: DigitalOceanDropletSize
    ) {
        console.log('create node pool()');

        await this.asyncInitialize();
        if (!this.kubernetesCluster?.id) {
            throw new Error('Kubernetes cluster not initialized yet');
        }

        const nodeRequest: ICreateNodePoolApiRequest = {
            kubernetes_cluster_id: this.kubernetesCluster.id,
            name: 'scraper-worker-node-pool-' + Date.now(),

            count: Configuration.singleton.scraperWorkerNodeCount,
            auto_scale: false,

            // see all droplet size slugs at
            // https://developers.digitalocean.com/documentation/changelog/api-v2/new-size-slugs-for-droplet-plan-changes/
            size: digitaloceanDropletSize,
            tags: [
                // for firewall auto-enrollment
                'project-shaungc-digitalocean-digitalocean-kubernetes-cluster-tag',

                // for scraper worker node selector
                KubernetesService.SCRAPER_WORKER_NODE_LABEL
            ]
        };

        const {
            data: { node_pool }
        } = await this.digitalOceanClient.kubernetes.createNodePool(
            nodeRequest
        );

        return node_pool;
    }

    public async _listScraperWorkerNodePool () {
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

        const primaryNodePools: IKubernetesClusterNodePool[] = [];
        const scraperWorkerNodePools: IKubernetesClusterNodePool[] = [];

        for (const nodePool of node_pools) {
            if (
                nodePool.tags.includes(
                    KubernetesService.SCRAPER_WORKER_NODE_LABEL
                )
            ) {
                scraperWorkerNodePools.push(nodePool);
            } else {
                primaryNodePools.push(nodePool);
            }
        }

        return {
            primaryNodePools,
            scraperWorkerNodePools
        };
    }

    public async _cleanScraperWorkerNodePools () {
        console.log('clean node pools()');

        await this.asyncInitialize();
        if (!this.kubernetesCluster?.id) {
            throw new Error('Kubernetes cluster not initialized yet');
        }

        const allScraperWorkerNodePools = await this._listScraperWorkerNodePool();
        const results: Readonly<DeleteNodePoolResponse>[] = [];
        for (let nodePool of allScraperWorkerNodePools.scraperWorkerNodePools) {
            const result = await this.digitalOceanClient.kubernetes.deleteNodePool(
                {
                    kubernetes_cluster_id: this.kubernetesCluster.id,
                    node_pool_id: nodePool.id
                }
            );
            results.push(result);

            console.log('delete status for node pool', nodePool.name, result);
        }

        return results;
    }

    public getReadyNodePool = async (nodePoolGroup: NodePoolGroupTypes) => {
        // check node pool is created, and at least one node is in ready state
        // use the first node pool with node(s) ready
        const nodePools = await this._listScraperWorkerNodePool();
        let readyNodePool: IKubernetesClusterNodePool | undefined;

        const nodePoolList =
            nodePoolGroup === 'scraperWorker'
                ? nodePools.scraperWorkerNodePools
                : nodePools.primaryNodePools;
        for (const nodepool of nodePoolList) {
            const readyNodes = nodepool.nodes.filter(
                node => node.status.state === 'running'
            );
            if (readyNodes.length) {
                readyNodePool = nodepool;
                break;
            }
        }

        return readyNodePool;
    };
}
