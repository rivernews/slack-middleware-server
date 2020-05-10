import { Request, Response, NextFunction } from 'express';
import { KubernetesService } from '../services/kubernetes/kubernetes';
import { ScraperNodeScaler } from '../services/kubernetes/kubernetesScaling';
import {
    KubernetesClientResponse,
    DigitalOceanDropletSize
} from '../services/kubernetes/types';
import { V1Deployment, V1Service } from '@kubernetes/client-node';
import { ParameterRequirementNotMet } from '../utilities/serverExceptions';
import { SeleniumMicroserviceType } from '../services/kubernetes/types';
import { DeleteNodePoolResponse } from 'dots-wrapper/dist/modules/kubernetes';

export const createNodeController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.log('create node controller, size =', req.body.size);

    const nodeInstanceSize = (typeof req.body.size === 'string' &&
    (req.body.size as string).toUpperCase() in DigitalOceanDropletSize
        ? (req.body.size as string).toUpperCase()
        : 'MEDIUM') as keyof typeof DigitalOceanDropletSize;

    const scraperWorkerNodePool = await KubernetesService.singleton._createScraperWorkerNodePool(
        DigitalOceanDropletSize[nodeInstanceSize]
    );

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
        deleteResponses: deleteResponses.map((res: DeleteNodePoolResponse) => {
            return {
                data: res.data,
                status: res.status
            };
        })
    });
};

export const getSeleniumMicroserviceController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.log('get selenium controller');
    const errors: Error[] = [];

    let hubDeploymentResult:
        | KubernetesClientResponse<V1Deployment>[]
        | undefined;
    try {
        hubDeploymentResult = await ScraperNodeScaler.singleton.getSeleniumMicroservicesDeployment(
            SeleniumMicroserviceType.hub
        );
    } catch (error) {
        errors.push(error);
    }

    let chromeNodeDeploymentResult:
        | KubernetesClientResponse<V1Deployment>[]
        | undefined;
    try {
        chromeNodeDeploymentResult = await ScraperNodeScaler.singleton.getSeleniumMicroservicesDeployment(
            SeleniumMicroserviceType['chrome-node']
        );
    } catch (error) {
        errors.push(error);
    }

    let serviceResult: KubernetesClientResponse<V1Service> | undefined;
    try {
        serviceResult = await ScraperNodeScaler.singleton.getSeleniumHubService();
    } catch (error) {
        errors.push(error);
    }

    return res.json({
        hubDeploymentResult:
            hubDeploymentResult?.length === 1
                ? hubDeploymentResult[0]
                : hubDeploymentResult,
        chromeNodeDeploymentResult:
            chromeNodeDeploymentResult?.length === 1
                ? chromeNodeDeploymentResult[0]
                : chromeNodeDeploymentResult,
        serviceResult,
        errors
    });
};

export const provisionSeleniumMicroserviceController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const { provisionType = SeleniumMicroserviceType.hub } = req.body;

    if (
        typeof provisionType !== 'string' ||
        !(provisionType in SeleniumMicroserviceType)
    ) {
        return next(
            new ParameterRequirementNotMet(
                'invalid provisionType value: ' + provisionType
            )
        );
    }

    let result = {};
    if (provisionType === 'hub') {
        result = await ScraperNodeScaler.singleton.orderSeleniumHubProvisioning();
    } else if (provisionType === 'chrome-node') {
        result = await ScraperNodeScaler.singleton.orderSeleniumChromeNodeProvisioning();
    }

    return res.json({ result });
};

export const removeSeleniumMicroserviceController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const result = await ScraperNodeScaler.singleton.orderScaleDown();
    res.json({ result });
};
