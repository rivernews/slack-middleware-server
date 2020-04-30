import { IncomingMessage } from 'http';

export interface KubernetesClientResponse<T> {
    response: IncomingMessage;
    body: T;
}

export enum DigitalOceanDropletSize {
    MEDIUM = 's-2vcpu-4gb',
    LARGE = 's-4vcpu-8gb',
    LARGE_16G = 's-6vcpu-16gb', // $80

    MEMORY_2CPU = 'm-16gb' // $75

    // all available standard slugs
    // https://developers.digitalocean.com/documentation/changelog/api-v2/new-size-slugs-for-droplet-plan-changes/

    // all available slugs, including memory-optimized
    // doctl compute size list

    // more pricing detail about each size & type
    // https://www.digitalocean.com/pricing/
}
