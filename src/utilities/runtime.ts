export enum RuntimeEnvironment {
    PRODUCTION = 'prodocution',
    DEVELOPMENT = 'development',

    TESTING = 'testing'
}

export const RUNTIME_CI_ENVIRONMENT = process.env.CI || '';
