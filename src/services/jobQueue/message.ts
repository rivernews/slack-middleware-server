import {
    ScraperJobMessageType,
    ScraperJobMessageTo,
    ScraperJobRequestData
} from './types';
import { RedisPubSubChannelName } from '../redis';

export const getPubsubChannelName = ({
    orgInfo = '',
    orgName = '',
    processedSession = 0,
    page = 0
}) => {
    return `${RedisPubSubChannelName.SCRAPER_JOB_CHANNEL}:${orgName ||
        orgInfo}:${processedSession}:startAtPage${page}`;
};

export const composePubsubMessage = (
    messageType: ScraperJobMessageType,
    messageTo: ScraperJobMessageTo,
    payload: string | Object
) => {
    const serializedPayload =
        typeof payload === 'string' ? payload : JSON.stringify(payload);
    return `${messageType}:${messageTo}:${serializedPayload}`;
};
