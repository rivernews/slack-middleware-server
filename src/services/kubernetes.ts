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
import { ScraperEnvironmentVariable } from './travis';
import { redisManager, JobQueueSharedRedisClientsSingleton } from './redis';
import { s3ArchiveManager } from './s3';
import { RuntimeEnvironment } from '../utilities/runtime';
import { ServerError } from '../utilities/serverExceptions';

// digitalocean client
// https://github.com/pjpimentel/dots

// kubernetes client
// https://github.com/kubernetes-client/javascript

export class KubernetesService {
    private static _singleton: KubernetesService;

    // smaller chunk of task is better especially when random network-related error occurr.
    // when bull retry the scraper job, we can have less overhead
    private static CROSS_SESSION_TIME_LIMIT_MINUTES = 60;

    private static DIGITALOCEAN_KUBERNETES_CLUSTER_NAME =
        'project-shaungc-digitalocean-cluster';

    private static JOB_NAMESPACE = 'slack-middleware-service';

    private kubernetesConfig?: KubeConfig;
    private kubernetesBatchClient?: BatchV1Api;

    private digitalOceanToken: string;

    public jobVacancySemaphore: Semaphore;

    private constructor () {
        if (!process.env.DIGITALOCEAN_ACCESS_TOKEN) {
            throw new Error('Digitalocean token not configured');
        }

        this.digitalOceanToken = process.env.DIGITALOCEAN_ACCESS_TOKEN;

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
            3,
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
        try {
            if (this.kubernetesBatchClient) {
                return;
            }

            // acquire kubernetes cluster credential first
            // similar to:
            // doctl kubernetes cluster kubeconfig show project-shaungc-digitalocean-cluster > kubeconfig.yaml

            const digitalOceanClient = createDigitalOceanClient({
                token: this.digitalOceanToken
            });

            let kubernetesClusters: IKubernetesCluster[] = [];
            try {
                let {
                    data: { kubernetes_clusters }
                } = await digitalOceanClient.kubernetes.listKubernetesClusters({
                    page: 1,
                    per_page: 999
                });
                console.log('kubernetes_clusters', kubernetes_clusters);

                kubernetesClusters = kubernetes_clusters;
            } catch (error) {
                console.error(error);
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

            if (!kubernetesCluster) {
                throw new Error(
                    `No kubernetes cluster matches name '${KubernetesService.DIGITALOCEAN_KUBERNETES_CLUSTER_NAME}'`
                );
            }

            let kubeconfigString = '';
            try {
                const {
                    data: kubeconfig
                } = await digitalOceanClient.kubernetes.getKubernetesClusterKubeconfig(
                    {
                        kubernetes_cluster_id: kubernetesCluster.id
                    }
                );
                console.log('kubeconfig', kubeconfig);

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

                                    CROSS_SESSION_TIME_LIMIT_MINUTES: KubernetesService.CROSS_SESSION_TIME_LIMIT_MINUTES.toString(),

                                    DEBUG: 'false',
                                    LOGGER_LEVEL: '3',

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
            if (error.response.statusCode === 401) {
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
}
