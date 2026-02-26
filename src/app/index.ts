import express from 'express';
import path from 'path';
import fs from 'fs';
import pkg from '../../package.json';

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

const dashboardPluginUrl: any = null;

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
    log.debug(
      `[Xenon] Stream drained for ${req.method} ${req.originalUrl}. Skipping local body-parser.`,
    );
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

const findPublicPath = () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const searchPaths = [
    path.join(rootDir, 'public'), // Production (lib/public)
    path.join(rootDir, 'src', 'public'), // Development (src/public)
    path.resolve(__dirname, '../public'), // Alternative structure
    path.resolve(__dirname, '../../public'),
    path.resolve(__dirname, '../../../public'),
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(path.join(p, 'index.html'))) {
      log.info(`[Xenon] Dashboard assets found at: ${p}`);
      return p;
    }
  }

  // Last resort fallback
  const fallback = path.resolve(__dirname, '../../public');
  log.warn(`[Xenon] Could not find dashboard index.html in standard paths. Falling back to: ${fallback}`);
  return fallback;
};

const publicPath = findPublicPath();
log.info(`[Xenon] Public assets path resolved to: ${publicPath}`);

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

  // Principal Health: Add ping endpoint
  apiRouter.get('/ping', (req, res) => res.json({ pong: true, version: pkg.version }));

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
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      log.error(`[Xenon] UI Fallback failed: index.html not found at ${indexPath}`);
      res.status(404).send('Xenon UI assets not found. Check installation.');
    }
  });

  return router;
}

export { createRouter };
