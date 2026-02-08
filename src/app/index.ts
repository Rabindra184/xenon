import express from 'express';
import path from 'path';

import { getCLIArgs } from '../data-service/pluginArgs';
import cors from 'cors';
import AsyncLock from 'async-lock';
import { InternalHttpClient } from '../InternalHttpClient';
import { config } from '../config';

import DashboardRouter from './routers/dashboard';
import GridRouter from './routers/grid';
import ControlRouter from './routers/control';
import AppsRouter from './routers/apps';
import webhookRouter from './routers/webhook';
import reservationRouter from './routers/reservation';
import ConfigRouter from './routers/config';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import fileUpload from 'express-fileupload';
import { setupSwagger } from './swagger';
import { Container } from 'typedi';

let dashboardPluginUrl: any = null;

const ASYNC_LOCK = new AsyncLock();

const router = express.Router(),
  apiRouter = express.Router(),
  staticFilesRouter = express.Router();

router.use(cors());
apiRouter.use(cors());
staticFilesRouter.use(cors());
router.use(fileUpload());

apiRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

/**
 * Middleware to check if the appium-dashboard plugin is installed
 * If the plugin is runnig, then we should enable the react app to
 * open the dashboard link upon clicking the device card in the UI.
 */

//TODO: Remove the middleware after integrating with dashbaod
apiRouter.use(async (req, res, next) => {
  await ASYNC_LOCK.acquire('dashboard-plugin-check', async () => {
    if (dashboardPluginUrl == null) {
      const pingurl = `${req.protocol}://${req.get('host')}/dashboard/api/ping`;
      try {
        const response: any = await InternalHttpClient.get(pingurl);
        if (response['pong']) {
          dashboardPluginUrl = `${req.protocol}://${req.get('host')}/dashboard`;
        } else {
          dashboardPluginUrl = '';
        }
      } catch (err) {
        dashboardPluginUrl = '';
      }
    }
  });
  (req as any)['dashboard-plugin-url'] = dashboardPluginUrl;
  return next();
});

apiRouter.get('/cliArgs', async (req, res) => {
  res.json(await getCLIArgs());
});

apiRouter.get('/metrics', async (req, res) => {
  const { MetricsService } = await import('../services/MetricsService');
  const metrics = await Container.get(MetricsService).getMetrics();
  res.set('Content-Type', 'text/plain');
  res.send(metrics);
});

staticFilesRouter.use(express.static(path.join(__dirname, '..', '..', 'public')));
router.use('/api', apiRouter);
router.use('/assets', express.static(config.sessionAssetsPath));
router.use(staticFilesRouter);



function createRouter(pluginArgs: IPluginArgs) {
  DashboardRouter.register(apiRouter);
  GridRouter.register(apiRouter, pluginArgs);
  ControlRouter.register(apiRouter);
  AppsRouter.register(apiRouter);
  webhookRouter.register(apiRouter);
  ConfigRouter.register(apiRouter, pluginArgs);
  apiRouter.use('/reservation', reservationRouter);

  // Setup Swagger API documentation at /xenon/api-docs
  try {
    setupSwagger(router, '/xenon');
  } catch (err) {
    console.warn('Swagger documentation not available. Install swagger-jsdoc and swagger-ui-express to enable.');
  }

  // Handle unmatched API routes with a 404 JSON response instead of the UI fallback
  apiRouter.use('*', (req, res) => {
    res.status(404).json({
      error: true,
      message: `API endpoint ${req.method} ${req.originalUrl} not found`,
    });
  });

  // Fallback route for client-side routing - serve index.html for all non-API routes
  // MUST be registered after Swagger to avoid interception
  router.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  return router;
}

export { createRouter };

