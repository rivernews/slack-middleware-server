import { ScraperJobMessageType, ScraperJobMessageTo } from './types';

export const composePubsubMessage = (
    messageType: ScraperJobMessageType,
    messageTo: ScraperJobMessageTo,
    payload: string | Object
) => {
    const serializedPayload =
        typeof payload === 'string' ? payload : JSON.stringify(payload);
    return `${messageType}:${messageTo}:${serializedPayload}`;
};
