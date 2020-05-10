import { KubernetesService } from './kubernetes';
import {
    V1Namespace,
    V1Deployment,
    V1Service,
    V1VolumeMount,
    V1Volume,
    V1LimitRange,
    V1ResourceRequirements,
    V1Probe,
    V1EnvVar
} from '@kubernetes/client-node';
import {
    KubernetesDeploymentArguments,
    SeleniumMicroserviceType,
    KubernetesClientResponse
} from '../kubernetes/types';
import { AssertionError } from 'assert';
import { ServerError } from '../../utilities/serverExceptions';
import Axios from 'axios';
import { IncomingMessage } from 'http';

export class ScraperNodeScaler {
    private static _singleton: ScraperNodeScaler;

    private static SELENIUM_APP_LABEL =
        KubernetesService.SCRAPER_WORK_NAMESPACE;
    private static SELENIUM_NAMESPACE = ScraperNodeScaler.SELENIUM_APP_LABEL;

    private kubernetesService: KubernetesService;

    private static SELENIUM_HUB_SERVICE: V1Service = {
        metadata: {
            name: `${ScraperNodeScaler.SELENIUM_APP_LABEL}-service`,
            labels: { app: ScraperNodeScaler.SELENIUM_APP_LABEL },
            namespace: ScraperNodeScaler.SELENIUM_NAMESPACE
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

    private static getSeleniumDefaultDefaultDeployment = ({
        identifier,
        nodePoolName,
        replicas = 1,
        image = '',
        ports = [],
        shareHostMemory = false,
        memoryLimit = '1000Mi',
        cpuLimit = '1',
        healthProbePath,
        healthProbePort,
        healthProbeCommand,
        envs
    }: KubernetesDeploymentArguments) => {
        // Validation

        for (const port of ports) {
            if (typeof port !== 'number') {
                throw new Error(
                    `When creating deployment object for ${identifier}, some ports are not number: ${ports.join(
                        ','
                    )}`
                );
            }
        }

        // Packaging values

        const volumeMounts: V1VolumeMount[] = [];
        const volumes: V1Volume[] = [];
        if (shareHostMemory) {
            volumeMounts.push({
                name: 'share-host-memory',
                mountPath: '/dev/shm'
            });

            volumes.push({
                name: 'share-host-memory',
                emptyDir: {
                    medium: 'Memory'
                }
            });
        }

        const resourceLimits: V1ResourceRequirements =
            cpuLimit || memoryLimit
                ? {
                      limits: {
                          memory: memoryLimit,
                          cpu: cpuLimit
                      }
                  }
                : {};

        // TODO: need to fix unresolved issue of kubernetes client:
        // https://github.com/kubernetes-client/javascript/issues/444
        const healthProbe: V1Probe | {} =
            (healthProbeCommand && healthProbeCommand.length) ||
            (healthProbePath && healthProbePort)
                ? {
                      // httpGet: {
                      //     path: healthProbePath,
                      //     port: healthProbePort
                      // },

                      // using command to health check
                      // https://github.com/SeleniumHQ/docker-selenium#adding-a-healthcheck-to-the-grid
                      exec:
                          healthProbeCommand && healthProbeCommand.length
                              ? {
                                    command: healthProbeCommand
                                }
                              : {},

                      initialDelaySeconds: 30,

                      // health check interval
                      periodSeconds: 15,

                      timeoutSeconds: 30
                  }
                : {};

        const environmentVariables = envs
            ? Object.keys(envs).map<V1EnvVar>(key => {
                  const value = envs[key as keyof typeof envs];
                  return {
                      name: key,
                      value
                  };
              })
            : [];

        // Object generation

        return {
            metadata: {
                name: ScraperNodeScaler.getSeleniumDeploymentName(identifier),
                labels: { app: ScraperNodeScaler.SELENIUM_APP_LABEL },
                namespace: ScraperNodeScaler.SELENIUM_NAMESPACE
            },
            spec: {
                replicas,
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
                                name: `${ScraperNodeScaler.SELENIUM_APP_LABEL}-${identifier}-container`,
                                image,
                                imagePullPolicy: 'Always',
                                ports: ports.map(port => ({
                                    name: `port-${port}`,
                                    containerPort: port
                                })),
                                volumeMounts,
                                env: environmentVariables
                                // resources: resourceLimits,
                                // readinessProbe: healthProbe,
                                // livenessProbe: healthProbe
                            }
                        ],
                        volumes,
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
        } as V1Deployment;
    };

    private static getSeleniumDeploymentName (type: SeleniumMicroserviceType) {
        return `${ScraperNodeScaler.SELENIUM_APP_LABEL}-${type}-deployment`;
    }

    private static getSeleniumHubDeployment: (
        nodePoolName: string
    ) => V1Deployment = nodePoolName => {
        return ScraperNodeScaler.getSeleniumDefaultDefaultDeployment({
            identifier: SeleniumMicroserviceType.hub,
            nodePoolName,
            replicas: 1,
            image: 'selenium/hub:latest',
            ports: [4444],
            healthProbePath: '/wd/hub/status',
            healthProbePort: 4444,
            healthProbeCommand: [
                '/opt/bin/check-grid.sh',
                '--host',
                '0.0.0.0',
                '--port',
                '4444'
            ]
        });
    };

    private static get seleniumHubHost () {
        const host = `${ScraperNodeScaler.SELENIUM_HUB_SERVICE.metadata?.name}.${ScraperNodeScaler.SELENIUM_NAMESPACE}.svc.cluster.local`;

        // TODO: remove this after things get stable
        if (
            host !==
            'selenium-service-service.selenium-service.svc.cluster.local'
        ) {
            throw new AssertionError({
                message:
                    'generated selenium hub host is not as expected: ' + host
            });
        }

        return host;
    }

    private static getSeleniumChromeNodeDeployment: (
        nodePoolName: string
    ) => V1Deployment = nodePoolName => {
        return ScraperNodeScaler.getSeleniumDefaultDefaultDeployment({
            identifier: SeleniumMicroserviceType['chrome-node'],
            nodePoolName,
            replicas: 8,
            image: 'selenium/node-chrome:latest',
            ports: [5555, 5900],
            shareHostMemory: true,
            envs: {
                HUB_HOST: ScraperNodeScaler.seleniumHubHost,
                HUB_PORT: '4444',
                START_XVFB: 'false'
            },
            cpuLimit: '.7'
        });
    };

    private static SELENIUM_HUB_DEPOYMENT = ScraperNodeScaler.getSeleniumDefaultDefaultDeployment(
        {
            identifier: SeleniumMicroserviceType.hub,
            image: '',
            nodePoolName: ''
        }
    );

    private static SELENIUM_CHROME_NODE_DEPOYMENT = ScraperNodeScaler.getSeleniumDefaultDefaultDeployment(
        {
            identifier: SeleniumMicroserviceType['chrome-node'],
            image: '',
            nodePoolName: ''
        }
    );

    // Scale down functions

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
            ScraperNodeScaler.SELENIUM_NAMESPACE
        );
        console.log('Delete namespace', delNs);

        // TODO: delete node / node pool as well
        // await this.kubernetesService._cleanScraperWorkerNodePools();

        return {
            status: 'OK',
            deleteNamespaceResponse: delNs
        };
    }

    // Scale up function

    public async orderSeleniumHubProvisioning () {
        await this.kubernetesService.asyncInitialize();
        if (
            !(
                this.kubernetesService.kubernetesCoreClient &&
                this.kubernetesService.kubernetesAppClient
            )
        ) {
            throw new Error(
                `Kubernetes Core Api client not initialized when provisioning selenium hub`
            );
        }

        const readyNodePool = await this.kubernetesService.getReadyNodePool(
            'scraperWorker'
        );
        if (!readyNodePool) {
            throw new ServerError(
                `No ready nodes while ordering selenium hub provisioning`
            );
        }

        // Create selenium microservice on the node:

        // create ns
        try {
            const getNsRes = await this.kubernetesService.kubernetesCoreClient.readNamespace(
                ScraperNodeScaler.SELENIUM_NAMESPACE
            );
            console.log(
                `Namespace ${ScraperNodeScaler.SELENIUM_NAMESPACE} already exist`,
                getNsRes.response
            );
        } catch (error) {
            const np: V1Namespace = {
                metadata: {
                    name: ScraperNodeScaler.SELENIUM_NAMESPACE,
                    labels: { app: ScraperNodeScaler.SELENIUM_APP_LABEL }
                }
            };
            const nsRes = await this.kubernetesService.kubernetesCoreClient.createNamespace(
                np
            );

            console.log('Created ns response', nsRes.response);
        }

        // create hub deploy
        ScraperNodeScaler.SELENIUM_HUB_DEPOYMENT = ScraperNodeScaler.getSeleniumHubDeployment(
            readyNodePool.name
        );
        const deployRes = await this.kubernetesService.kubernetesAppClient.createNamespacedDeployment(
            ScraperNodeScaler.SELENIUM_NAMESPACE,
            ScraperNodeScaler.SELENIUM_HUB_DEPOYMENT
        );
        console.log('Create deployment', deployRes.response);

        // create svc
        const svcRes = await this.kubernetesService.kubernetesCoreClient.createNamespacedService(
            ScraperNodeScaler.SELENIUM_NAMESPACE,
            ScraperNodeScaler.SELENIUM_HUB_SERVICE
        );
        console.log('Create service', svcRes.response);

        return {
            deployRes,
            svcRes
        };
    }

    public async orderSeleniumChromeNodeProvisioning () {
        await this.kubernetesService.asyncInitialize();
        if (
            !(
                this.kubernetesService.kubernetesCoreClient &&
                this.kubernetesService.kubernetesAppClient
            )
        ) {
            throw new Error(
                `Kubernetes Core Api client not initialized when provisioning selenium chrome node`
            );
        }

        const readyNodePool = await this.kubernetesService.getReadyNodePool(
            'scraperWorker'
        );
        if (!readyNodePool) {
            throw new ServerError(
                `No ready nodes while ordering selenium chrome node provisioning`
            );
        }

        // check selenium hub
        try {
            const res = Axios.get(
                `http://${ScraperNodeScaler.seleniumHubHost}:4444`
            );
        } catch (error) {
            throw new ServerError(
                'Selenium Hub is not ready, cannot provision chrome node: ' +
                    (error instanceof Error
                        ? error.message
                        : JSON.stringify(error))
            );
        }

        // check chrome node deploymet
        ScraperNodeScaler.SELENIUM_CHROME_NODE_DEPOYMENT = ScraperNodeScaler.getSeleniumChromeNodeDeployment(
            readyNodePool.name
        );
        const deployRes = await this.kubernetesService.kubernetesAppClient.createNamespacedDeployment(
            ScraperNodeScaler.SELENIUM_NAMESPACE,
            ScraperNodeScaler.SELENIUM_CHROME_NODE_DEPOYMENT
        );
        console.log('Create deployment', deployRes.body.status);

        return {
            deploymentResponse: deployRes.response
        };
    }

    // GET functions

    public async getSeleniumHubService () {
        await this.kubernetesService.asyncInitialize();
        if (!this.kubernetesService.kubernetesCoreClient) {
            throw new Error(
                `Kubernetes Core Api client not initialized when getting selenium service`
            );
        }

        const serviceName =
            ScraperNodeScaler.SELENIUM_HUB_SERVICE.metadata?.name;
        if (!serviceName) {
            throw new Error('Service name undefined');
        }

        return await this.kubernetesService.kubernetesCoreClient.readNamespacedService(
            serviceName,
            ScraperNodeScaler.SELENIUM_NAMESPACE
        );
    }

    public getSeleniumMicroservicesDeployment = async (
        type?: SeleniumMicroserviceType
    ) => {
        await this.kubernetesService.asyncInitialize();
        if (!this.kubernetesService.kubernetesAppClient) {
            throw new Error(
                `Kubernetes App Api client not initialized when getting selenium hub deployment`
            );
        }

        let queryDeploymentTypes: SeleniumMicroserviceType[] = [];

        if (typeof type === 'undefined') {
            queryDeploymentTypes = Array.from(
                Object.keys(SeleniumMicroserviceType)
            ) as SeleniumMicroserviceType[];
        } else {
            queryDeploymentTypes.push(type);
        }

        const results: KubernetesClientResponse<V1Deployment>[] = [];
        for (const deploymentType of queryDeploymentTypes) {
            const deploymentName = ScraperNodeScaler.getSeleniumDeploymentName(
                deploymentType
            );
            const result = await this.kubernetesService.kubernetesAppClient.readNamespacedDeployment(
                deploymentName,
                ScraperNodeScaler.SELENIUM_NAMESPACE
            );
            results.push(result);
        }

        return results;
    };
}
