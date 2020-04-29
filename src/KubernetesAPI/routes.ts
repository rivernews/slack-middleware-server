import express from 'express';
import { corsConfig } from '../utilities/authenticators';
import {
    createNodeController,
    listNodeController,
    cleanNodeController,
    getSeleniumMicroserviceController,
    provisionSeleniumMicroserviceController,
    removeSeleniumMicroserviceController
} from './controllers';

export const kubernetesApiRouter = express.Router();

// sub route base
export const kubernetesApiBaseUrl = '/k8s';

// endpoints
export const createNodeEndpoint = '/create-node';
export const listNodeEndpoint = '/list-node';
export const cleanNodeEndpoint = '/clean-node';
export const seleniumMicroServiceEndpoint = '/selenium';

// register controllers
kubernetesApiRouter.use(corsConfig);
kubernetesApiRouter.post(createNodeEndpoint, createNodeController);
kubernetesApiRouter.post(listNodeEndpoint, listNodeController);
kubernetesApiRouter.post(cleanNodeEndpoint, cleanNodeController);
kubernetesApiRouter.get(
    seleniumMicroServiceEndpoint,
    getSeleniumMicroserviceController
);
kubernetesApiRouter.post(
    seleniumMicroServiceEndpoint,
    provisionSeleniumMicroserviceController
);
kubernetesApiRouter.delete(
    seleniumMicroServiceEndpoint,
    removeSeleniumMicroserviceController
);
