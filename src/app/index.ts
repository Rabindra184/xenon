import express from 'express';
import path from 'path';
import fs from 'fs';

import { getCLIArgs } from '../data-service/pluginArgs';
import cors from 'cors';
import AsyncLock from 'async-lock';
import { InternalHttpClient } from '../InternalHttpClient';
import { config } from '../config';
import log, { redactSecrets } from '../logger';

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

apiRouter.use((req: any, res, next) => {
  // Defensive Body Parsing Logic:
  // In some Appium versions, the global HTTP logger or other middleware drains the request stream
  // before it reaches the plugin. Re-calling express.json() on a drained stream throws 
  // 'InternalServerError: stream is not readable'.

  // 1. If body is already an object (parsed by parent), proceed.
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return next();
  }

  // 2. If stream is already spent and nothing was parsed, we can't do much, just proceed gracefully.
  if (!req.readable) {
    log.debug(`[Xenon] Stream drained for ${req.method} ${req.originalUrl}. Skipping local body-parser.`);
    return next();
  }

  // 3. Otherwise, try safe parsing.
  express.json()(req, res, (err) => {
    if (err) {
      log.warn(`[Xenon] Body parsing failed for ${req.originalUrl}: ${err.message}`);
      // Continue without failing - handlers will validate missing body
      return next();
    }
    next();
  });
});

apiRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Redact secrets from request body to prevent them from leaking into external logs
  if (req.body && typeof req.body === 'object') {
    req.body = redactSecrets(req.body);
  }
  next();
});

// Dashboard state cache - runs once and persists
let dashboardPluginPromise: Promise<string> | null = null;

apiRouter.use(async (req, res, next) => {
  if (dashboardPluginPromise === null) {
    dashboardPluginPromise = (async () => {
      const pingurl = `${req.protocol}://${req.get('host')}/dashboard/api/ping`;
      try {
        const response: any = await InternalHttpClient.get(pingurl, { silent: true } as any);
        return response['pong'] ? `${req.protocol}://${req.get('host')}/dashboard` : '';
      } catch (err) {
        return '';
      }
    })();
  }

  (req as any)['dashboard-plugin-url'] = await dashboardPluginPromise;
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

const publicPath =
  [path.join(__dirname, '..', 'public'), path.join(__dirname, '..', '..', 'public')].find((p) =>
    fs.existsSync(p),
  ) || path.join(__dirname, '..', '..', 'public');

staticFilesRouter.use(express.static(publicPath));
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
    log.warn(
      'Swagger documentation not available. Install swagger-jsdoc and swagger-ui-express to enable.',
    );
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
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  return router;
}

export { createRouter };
