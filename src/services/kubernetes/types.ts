import { IncomingMessage } from 'http';

export interface KubernetesClientResponse<T> {
    response: IncomingMessage;
    body: T;
}

export enum DigitalOceanDropletSize {
    // will get 422, perhaps not available in k8
    // see all available sizes in k8
    // https://www.digitalocean.com/docs/kubernetes/
    // SINGLE_UNIT = 's-1vcpu-1gb', // $5

    SMALL_3G = 's-1vcpu-3gb', // $15

    SMALL = 's-1vcpu-2gb', // $10
    MEDIUM = 's-2vcpu-4gb', // $20
    LARGE = 's-4vcpu-8gb', // $40
    LARGE_16G = 's-6vcpu-16gb', // $80, 1:4

    MEMORY_2CPU = 'm-16gb', // $75, 1:8

    CPU_4CPU = 'c-4', // $80, 1:2
    CPU_2CPU = 'c-2' // $40, 1:2

    // all available standard slugs
    // https://developers.digitalocean.com/documentation/changelog/api-v2/new-size-slugs-for-droplet-plan-changes/

    // all available slugs, including memory-optimized
    // doctl compute size list

    // more pricing detail about each size & type
    // https://www.digitalocean.com/pricing/
}

export interface KubernetesDeploymentArguments {
    identifier: SeleniumMicroserviceType;
    nodePoolName: string;
    replicas?: number;
    image: string;
    ports?: number[];
    shareHostMemory?: boolean;
    memoryLimit?: string;
    cpuLimit?: string;
    healthProbePath?: string;
    healthProbePort?: number;
    healthProbeCommand?: string[];
    envs?: { [key: string]: string };
}

export enum SeleniumMicroserviceType {
    'hub' = 'hub',
    'chrome-node' = 'chrome-node'
}

export enum SeleniumArchitectureType {
    'hub-node' = 'hub-node',
    'pod-standalone' = 'pod-standalone'
}

export type NodePoolGroupTypes = 'primary' | 'scraperWorker';
