import express from 'express';
import path from 'path';
import fs from 'fs';
import pkg from '../../package.json';

import { getCLIArgs } from '../data-service/pluginArgs';
import cors from 'cors';
import AsyncLock from 'async-lock';
import crypto from 'crypto';
import { InternalHttpClient } from '../InternalHttpClient';
import { config } from '../config';
import log from '../logger';
import { sessionContext } from '../logging/sessionContext';

import DashboardRouter from './routers/dashboard';
import GridRouter from './routers/grid';
import ControlRouter from './routers/control';
import AppsRouter from './routers/apps';
import webhookRouter from './routers/webhook';
import reservationRouter from './routers/reservation';
import ConfigRouter from './routers/config';
import { apiKeysRouter } from './routers/apikeys';
import { authRouter } from './routers/auth';
import { processesRouter } from './routers/processes';
import { apiKeyMiddleware } from '../middleware/apiKeyMiddleware';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
import { nodeSecretMiddleware } from '../middleware/nodeSecretMiddleware';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import fileUpload from 'express-fileupload';
import { setupSwagger } from './swagger';
import { Container } from 'typedi';

const dashboardPluginUrl: any = null;

const ASYNC_LOCK = new AsyncLock();

const router = express.Router(),
  apiRouter = express.Router(),
  staticFilesRouter = express.Router();

// API is same-origin with the dashboard; block cross-origin browser callers.
// Non-browser clients (curl, CLI, SDKs) send no Origin header and are unaffected.
// Parent `router` has no cors() — if it did, its wildcard would leak through
// to apiRouter responses because cors({origin:false}) below doesn't strip
// headers set earlier in the chain. Static files keep permissive cors() so
// the dashboard bundle can be embedded from anywhere if needed.
apiRouter.use(cors({ origin: false }));
staticFilesRouter.use(cors());

// Tag every API request with an AsyncLocalStorage frame so downstream logs
// (handlers, DB calls, outbound HTTP from InternalHttpClient) can attribute
// themselves to this request/session without plumbing IDs through every call.
// Regex picks up sessionId from /session/<id>/... paths so the context is
// populated before the individual handler runs.
const SESSION_ID_PATH_RE = /\/session\/([a-zA-Z0-9_-]{8,})(?:\/|$)/;
apiRouter.use((req, res, next) => {
  const inboundId = (req.headers['x-request-id'] as string) || '';
  const requestId = inboundId || crypto.randomUUID();
  const match = SESSION_ID_PATH_RE.exec(req.path);
  const sessionId = match ? match[1] : undefined;
  res.setHeader('X-Request-Id', requestId);
  sessionContext.run({ requestId, sessionId }, () => next());
});

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
  next();
});

// Dashboard state cache - runs once and persists on success.
// On failure we back off exponentially (1s → 2s → 4s → … capped at 30s)
// so a down dashboard doesn't turn every API request into a fresh ping.
let dashboardPluginPromise: Promise<string> | null = null;
let dashboardNextRetryAt = 0;
let dashboardRetryDelayMs = 1000;
const DASHBOARD_RETRY_MAX_MS = 30_000;

apiRouter.use(async (req, res, next) => {
  if (dashboardPluginPromise === null && Date.now() >= dashboardNextRetryAt) {
    dashboardPluginPromise = (async () => {
      const pingurl = `${req.protocol}://${req.get('host')}/dashboard/api/ping`;
      try {
        const response: any = await InternalHttpClient.get(pingurl, { silent: true } as any);
        if (response && response['pong']) {
          dashboardRetryDelayMs = 1000;
          dashboardNextRetryAt = 0;
          return `${req.protocol}://${req.get('host')}/dashboard`;
        }
      } catch (err: any) {
        log.warn(
          `[Xenon] Dashboard ping failed, retrying in ${dashboardRetryDelayMs}ms: ${
            err?.message || err
          }`,
        );
      }
      dashboardNextRetryAt = Date.now() + dashboardRetryDelayMs;
      dashboardRetryDelayMs = Math.min(dashboardRetryDelayMs * 2, DASHBOARD_RETRY_MAX_MS);
      dashboardPluginPromise = null;
      return '';
    })();
  }

  (req as any)['dashboard-plugin-url'] = dashboardPluginPromise ? await dashboardPluginPromise : '';
  return next();
});

const findPublicPath = () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const searchPaths = [
    path.join(rootDir, 'public'), // Production (lib/public)
    path.join(rootDir, 'src', 'public'), // Development (src/public)
    path.resolve(__dirname, '../public'), // Alternative structure
    path.resolve(__dirname, '../../public'),
    path.resolve(__dirname, '../../../public'),
    path.resolve(__dirname, '../../../../public'),
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
log.info(`[Xenon] Dashboard assets path: ${publicPath}`);
log.info(`[Xenon] Dashboard available at: /xenon/ (e.g. http://localhost:4723/xenon/)`);

// CSP for the dashboard. Keeps 'unsafe-inline' (React/Vite inline styles),
// drops 'unsafe-eval' and the default-src wildcard to avoid full XSS-to-RCE.
// Google Fonts (fonts.googleapis.com for CSS, fonts.gstatic.com for woff2)
// are explicitly allowlisted because the bundled stylesheets @import them.
router.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' ws: wss: http: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "frame-ancestors 'self'",
    ].join('; ') + ';',
  );
  next();
});

staticFilesRouter.use(express.static(publicPath, { index: false }));
router.use('/api', apiRouter);
// Principal Fix: Rename collision route from /assets to /session-recordings to avoid conflict with dashboard's /assets folder
router.use('/session-recordings', express.static(config.sessionAssetsPath));
router.use(staticFilesRouter);

function createRouter(pluginArgs: IPluginArgs) {
  // Health endpoint: no auth, no rate limit
  apiRouter.get('/health', (_req, res) => res.json({ ok: true }));

  // Hub-node channel: node-secret auth instead of API key
  apiRouter.use(
    ['/register', '/unblock'],
    nodeSecretMiddleware(pluginArgs.nodeSecret || process.env.XENON_NODE_SECRET),
  );

  // Dashboard login: unauthenticated (rate-limited internally via separate IP logic)
  apiRouter.use('/auth', authRouter());

  // All remaining /api/* requires API key + rate limit
  apiRouter.use(apiKeyMiddleware);
  apiRouter.use(rateLimitMiddleware());

  // Admin: API key management
  apiRouter.use('/apikeys', apiKeysRouter());
  // Admin: running process snapshot (ops debugging)
  apiRouter.use('/processes', processesRouter());

  // Exposes plugin CLI args (may include host, hub URL, etc.) — auth-gated.
  apiRouter.get('/cliArgs', async (_req, res) => {
    res.json(await getCLIArgs());
  });

  // Prometheus-style metrics — auth-gated to avoid operational recon.
  apiRouter.get('/metrics', async (_req, res) => {
    const { MetricsService } = await import('../services/MetricsService');
    const metrics = await Container.get(MetricsService).getMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  });

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
  router.get('*', (req, res) => {
    const indexPath = path.resolve(publicPath, 'index.html');
    const url = req.originalUrl || req.url;

    // Skip if it's an API call that somehow reached here
    if (url.includes('/api/')) return res.status(404).json({ error: true, message: 'Not Found' });

    log.debug(`[Xenon] UI Fallback triggered for: ${url}. Targeting: ${indexPath}`);

    if (fs.existsSync(indexPath)) {
      try {
        const html = fs.readFileSync(indexPath, 'utf-8');
        res.set('Content-Type', 'text/html');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return res.send(html);
      } catch (err: any) {
        log.error(`[Xenon] UI Fallback read error for ${indexPath}: ${err.message}`);
        return res.status(500).send(`Xenon UI Asset Error: ${err.message}`);
      }
    } else {
      log.error(`[Xenon] UI Fallback failed: index.html not found at ${indexPath}`);
      // Diagnostic: List files in publicPath
      try {
        const files = fs.readdirSync(publicPath);
        log.error(`[Xenon] Contents of ${publicPath}: ${files.join(', ')}`);
      } catch (e: any) {
        log.error(`[Xenon] Could not even read directory ${publicPath}: ${e.message}`);
      }
      return res.status(404).send('Xenon UI assets not found. Check installation.');
    }
  });
  return router;
}

export { createRouter };
