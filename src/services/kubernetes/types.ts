import { IncomingMessage } from 'http';

export interface KubernetesClientResponse<T> {
    response: IncomingMessage;
    body: T;
}

export enum DigitalOceanDropletSize {
    MEDIUM = 's-2vcpu-4gb',
    LARGE = 's-4vcpu-8gb'
}
