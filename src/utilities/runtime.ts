export enum RuntimeEnvironment {
    PRODUCTION = 'prodocution',
    DEVELOPMENT = 'development',

    TESTING = 'testing'
}

export const RUNTIME_ENVIRONMENT = process.env.CI || '';
