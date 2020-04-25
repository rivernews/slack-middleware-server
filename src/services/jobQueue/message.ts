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
    const patchedOrgName = orgName.replace(/[^0-9a-zA-Z]/g, '-');

    return `${RedisPubSubChannelName.SCRAPER_JOB_CHANNEL}:${patchedOrgName ||
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
