import { IncomingMessage } from 'http';

export interface KubernetesClientResponse<T> {
    response: IncomingMessage;
    body: T;
}
