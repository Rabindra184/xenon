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
import { IPluginArgs } from '../interfaces/IPluginArgs';
import fileUpload from 'express-fileupload';

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

staticFilesRouter.use(express.static(path.join(__dirname, '..', '..', 'public')));
router.use('/api', apiRouter);
router.use('/assets', express.static(config.sessionAssetsPath));
router.use(staticFilesRouter);

// Fallback route for client-side routing - serve index.html for all non-API routes
router.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

function createRouter(pluginArgs: IPluginArgs) {
  DashboardRouter.register(apiRouter);
  GridRouter.register(apiRouter, pluginArgs);
  ControlRouter.register(apiRouter);
  AppsRouter.register(apiRouter);
  webhookRouter.register(apiRouter);
  apiRouter.use('/reservation', reservationRouter);
  return router;
}

export { createRouter };
