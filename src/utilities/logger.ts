import { createLogger, format } from 'winston';
import { Configuration } from './configuration';

// winston logger
// https://github.com/winstonjs/winston#creating-your-own-logger

export const Logger = createLogger({
    level: Configuration.singleton.logLevel,
    format: format.simple(),
    defaultMeta: {
        pid: process.pid
    }
});

// TODO: add prefix like 🔴 🟠 ... --> format

// TODO: integrate with opt-in slack message --> transport? + level?
// slack transport! https://github.com/winstonjs/winston/blob/master/docs/transports.md#slack-transport

// TODO: being able to add to redis --> transport?
// redis transport: https://github.com/winstonjs/winston/blob/master/docs/transports.md#redis-transport
