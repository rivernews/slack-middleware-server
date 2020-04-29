import { KubernetesService } from './kubernetes';
import {
    V1Namespace,
    V1Deployment,
    V1DeploymentStrategy,
    V1Service,
    ApisApi
} from '@kubernetes/client-node';
import { IKubernetesClusterNodePool } from 'dots-wrapper/dist/modules/kubernetes/types';

export class ScraperNodeScaler {
    private static _singleton: ScraperNodeScaler;

    private kubernetesService: KubernetesService;

    private static SELENIUM_APP_LABEL = 'selenium-service';

    private static SELENIUM_SERVICE: V1Service = {
        metadata: {
            name: `${ScraperNodeScaler.SELENIUM_APP_LABEL}-service`,
            labels: { app: ScraperNodeScaler.SELENIUM_APP_LABEL }
        },
        spec: {
            type: 'ClusterIP',
            selector: { app: ScraperNodeScaler.SELENIUM_APP_LABEL },
            ports: [
                {
                    name: 'port-4444',
                    port: 4444
                    // TODO: seems like type in this package is not correct
                    // targetPort: {

                    // }
                }
            ]
        }
    };

    private constructor () {
        this.kubernetesService = KubernetesService.singleton;
    }

    public static get singleton () {
        if (!ScraperNodeScaler._singleton) {
            ScraperNodeScaler._singleton = new ScraperNodeScaler();
        }
        return ScraperNodeScaler._singleton;
    }

    private static getSeleniumDeployment: (
        nodePoolName: string
    ) => V1Deployment = nodePoolName => ({
        metadata: {
            name: `${ScraperNodeScaler.SELENIUM_APP_LABEL}-deployment`,
            labels: { app: ScraperNodeScaler.SELENIUM_APP_LABEL }
        },
        spec: {
            replicas: 1,
            strategy: {
                type: 'Recreate'
            },

            selector: {
                matchLabels: { app: ScraperNodeScaler.SELENIUM_APP_LABEL }
            },

            template: {
                metadata: {
                    labels: { app: ScraperNodeScaler.SELENIUM_APP_LABEL }
                },
                spec: {
                    containers: [
                        {
                            name: ScraperNodeScaler.SELENIUM_APP_LABEL,
                            image:
                                'selenium/standalone-chrome:3.141.59-zirconium',
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
                                }
                            ]
                        }
                    ],
                    volumes: [
                        {
                            name: 'share-host-memory',
                            emptyDir: {
                                medium: 'Memory'
                            }
                        }
                    ],
                    nodeSelector: {
                        // wait for node in node pool be ready first
                        // then pass over the node pool
                        // (or even use node id)
                        'doks.digitalocean.com/node-pool': nodePoolName

                        // 'doks.digitalocean.com/node-id': ''
                    }
                }
            }
        }
    });

    private static SELENIUM_DEPOYMENT = ScraperNodeScaler.getSeleniumDeployment(
        ''
    );

    // public async scaleUp() {
    //     const nodePoolName = await this._provisionNodeResources();

    //     // TODO: need to wait till node in node pool is ready

    //     this._provisionSelenium(nodePoolName);
    // }

    public async orderScaleDown () {
        await this.kubernetesService.asyncInitialize();
        if (
            !(
                this.kubernetesService.kubernetesCoreClient &&
                this.kubernetesService.kubernetesAppClient
            )
        ) {
            throw new Error(
                `Kubernetes Core Api client not initialized when scaling down scraper worker node`
            );
        }

        // delete ns

        const delNs = await this.kubernetesService.kubernetesCoreClient.deleteNamespace(
            ScraperNodeScaler.SELENIUM_APP_LABEL
        );
        console.log('Delete namespace', delNs);

        // TODO: delete node / node pool as well
        // await this.kubernetesService._cleanScraperWorkerNodePools();

        return {
            status: 'OK',
            deleteNamespaceResponse: delNs
        };
    }

    // private async _provisionNodeResources() {
    //     const nodePool = await this.kubernetesService._createScraperWorkerNodePool();
    //     return nodePool.name
    // }

    public async orderSeleniumProvisioning () {
        await this.kubernetesService.asyncInitialize();
        if (
            !(
                this.kubernetesService.kubernetesCoreClient &&
                this.kubernetesService.kubernetesAppClient
            )
        ) {
            throw new Error(
                `Kubernetes Core Api client not initialized when provisioning selenium`
            );
        }

        const readyNodePool = await this.kubernetesService.getReadyNodePool(
            'scraperWorker'
        );
        if (!readyNodePool) {
            throw new Error(
                `No ready nodes while ordering selenium provisioning`
            );
        }

        // create selenium microservice on the node:

        // create ns
        try {
            const getNsRes = await this.kubernetesService.kubernetesCoreClient.readNamespace(
                ScraperNodeScaler.SELENIUM_APP_LABEL
            );
            console.log(
                `Namespace ${ScraperNodeScaler.SELENIUM_APP_LABEL} already exist`,
                getNsRes.response
            );
        } catch (error) {
            const np: V1Namespace = {
                metadata: {
                    name: ScraperNodeScaler.SELENIUM_APP_LABEL,
                    labels: { app: ScraperNodeScaler.SELENIUM_APP_LABEL }
                }
            };
            const nsRes = await this.kubernetesService.kubernetesCoreClient.createNamespace(
                np
            );

            console.log('Created ns response', nsRes.response);
        }

        // create deploy
        ScraperNodeScaler.SELENIUM_DEPOYMENT = ScraperNodeScaler.getSeleniumDeployment(
            readyNodePool.name
        );
        const deployRes = await this.kubernetesService.kubernetesAppClient.createNamespacedDeployment(
            ScraperNodeScaler.SELENIUM_APP_LABEL,
            ScraperNodeScaler.SELENIUM_DEPOYMENT
        );
        console.log('Create deployment', deployRes.response);

        // create svc
        const svcRes = await this.kubernetesService.kubernetesCoreClient.createNamespacedService(
            ScraperNodeScaler.SELENIUM_APP_LABEL,
            ScraperNodeScaler.SELENIUM_SERVICE
        );
        console.log('Create service', svcRes.response);

        return {
            deployRes,
            svcRes
        };
    }

    public async getSeleniumService () {
        await this.kubernetesService.asyncInitialize();
        if (!this.kubernetesService.kubernetesCoreClient) {
            throw new Error(
                `Kubernetes Core Api client not initialized when getting selenium service`
            );
        }

        const serviceName = ScraperNodeScaler.SELENIUM_SERVICE.metadata?.name;
        if (!serviceName) {
            throw new Error('Service name undefined');
        }
        return await this.kubernetesService.kubernetesCoreClient.readNamespacedService(
            serviceName,
            ScraperNodeScaler.SELENIUM_APP_LABEL
        );
    }

    public getSeleniumDeployment = async () => {
        await this.kubernetesService.asyncInitialize();
        if (!this.kubernetesService.kubernetesAppClient) {
            throw new Error(
                `Kubernetes App Api client not initialized when getting selenium deployment`
            );
        }

        const deploymentName =
            ScraperNodeScaler.SELENIUM_DEPOYMENT.metadata?.name;
        if (!deploymentName) {
            throw new Error('Deployment name undefined');
        }
        return await this.kubernetesService.kubernetesAppClient.readNamespacedDeployment(
            deploymentName,
            ScraperNodeScaler.SELENIUM_APP_LABEL
        );
    };
}
