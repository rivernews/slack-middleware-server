import { Request, Response, NextFunction } from 'express';
import { KubernetesService } from '../services/kubernetes/kubernetes';
import { ScraperNodeScaler } from '../services/kubernetes/kubernetesScaling';
import { KubernetesClientResponse } from '../services/kubernetes/types';
import { V1Deployment, V1Service } from '@kubernetes/client-node';

export const createNodeController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.log('create node controller');
    const scraperWorkerNodePool = await KubernetesService.singleton._createScraperWorkerNodePool();

    console.log('scraper worker node pools', scraperWorkerNodePool);

    return res.json({
        scraperWorkerNodePool
    });
};

export const listNodeController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const scraperWorkerNodePools =
        (await KubernetesService.singleton._listScraperWorkerNodePool())
            .scraperWorkerNodePools || [];

    return res.json({
        scraperWorkerNodePools
    });
};

export const cleanNodeController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.log('clean node controller ');

    const deleteResponses = await KubernetesService.singleton._cleanScraperWorkerNodePools();

    return res.json({
        status: 'OK',
        deleteResponses
    });
};

export const getSeleniumMicroserviceController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const errors: Error[] = [];

    let deploymentResult: KubernetesClientResponse<V1Deployment> | undefined;
    try {
        deploymentResult = await ScraperNodeScaler.singleton.getSeleniumDeployment();
    } catch (error) {
        errors.push(error);
    }

    let serviceResult: KubernetesClientResponse<V1Service> | undefined;
    try {
        serviceResult = await ScraperNodeScaler.singleton.getSeleniumService();
    } catch (error) {
        errors.push(error);
    }

    return res.json({
        deploymentResult,
        serviceResult,
        errors
    });
};

export const provisionSeleniumMicroserviceController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const result = await ScraperNodeScaler.singleton.orderSeleniumProvisioning();

    res.json({ result });
};

export const removeSeleniumMicroserviceController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const result = await ScraperNodeScaler.singleton.orderScaleDown();
    res.json({ result });
};
