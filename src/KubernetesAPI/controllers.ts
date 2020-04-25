import { Request, Response, NextFunction } from 'express';
import { KubernetesService } from '../services/kubernetes';

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
    console.log('list node controller');
    const scraperWorkerNodePools = await KubernetesService.singleton._listScraperWorkerNodePool();

    console.log(
        'scraper worker node pools',
        scraperWorkerNodePools.map(np => np.name)
    );
    console.log(
        'nodes',
        scraperWorkerNodePools.map(np => np.nodes.map(node => node.status))
    );

    return res.json({
        scraperWorkerNodePools
    });
};

export const cleanNodeController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.log('clean node controller');

    await KubernetesService.singleton._cleanScraperWorkerNodePools();

    return res.json({
        status: 'OK'
    });
};
