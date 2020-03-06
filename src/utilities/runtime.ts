export enum RuntimeEnvironment {
    PRODUCTION = 'prodocution',
    DEVELOPMENT = 'development',
    TESTING = 'testing'
}

export const RUNTIME_CI_ENVIRONMENT = process.env.CI || '';

export const toPercentageValue = (value: number): number => {
    return parseFloat((value * 100.0).toFixed(2));
};
