import { Request, Response, NextFunction } from 'express';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { unblockDeviceMatchingFilter, updateCmdExecutedTime } from '../data-service/device-service';
import axios from 'axios';
import log from '../logger';
import { hasHubArgument } from '../helpers';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { routeToCommandName } from '@appium/base-driver';

const remoteProxyMap: Map<string, any> = new Map();
const remoteHostMap: Map<string, any> = new Map();

function getProxyServer() {
  return process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
}

export function addProxyHandler(sessionId: string, remoteHost: string) {
  const proxyServer = getProxyServer();
  const targetBasePath = new URL(remoteHost).pathname;
  const config: any = {
    target: new URL(remoteHost).origin,
    changeOrigin: true,
    pathRewrite: (path: any, _req: any) => {
      const newPath = `${targetBasePath}/${path}`;
      return newPath;
    },
    on: {
      proxyReq: fixRequestBody,
      proxyRes: (_proxyRes: any, _req: any, _res: any) => {
        // log.debug(`proxyRes host: ${req.headers.host} method: ${req.method}  path: ${req.url}`);
      },
      error: (err: any, _req: any, _res: any) => {
        log.error('proxy handler error: ', err.message, ' data: ', err.response.data);
      },
    },
  };

  if (proxyServer) {
    //log.info(`Added proxy to createProxyMiddleware: ${JSON.stringify(proxyServer)}`);
    config.agent = new HttpsProxyAgent(proxyServer);
  }

  log.info(`Creating remote proxy for session ${sessionId} to ${remoteHost}`);
  remoteProxyMap.set(sessionId, createProxyMiddleware(config));
  remoteHostMap.set(sessionId, remoteHost);
}

export function removeProxyHandler(sessionId: string) {
  remoteProxyMap.delete(sessionId);
}

function getSessionIdFromUr(url: string) {
  const SESSION_ID_PATTERN = /\/session\/([^/]+)/;
  const match = SESSION_ID_PATTERN.exec(url);
  if (match) {
    return match[1];
  }
  return null;
}

function handler(cliArgs: Record<string, any>) {
  const WEBDRIVER_BASE_PATH = (cliArgs['basePath'] || '').replace(/\/$/, '') + '/session';
  const isHub = !hasHubArgument(cliArgs); //if hub cliArg is provided, then current appium process serves as a NODE
  return async (req: Request, res: Response, next: NextFunction) => {
    if (new RegExp(/wd-internal\//).test(req.url)) {
      req.url = req.originalUrl = req.url.replace('wd-internal/', '');
      return next();
    }

    if (isHub && !req.path.startsWith(WEBDRIVER_BASE_PATH)) {
      log.info(
        `Received non-webdriver request with url ${req.path}. So, not proxying it to downstream.`,
      );
      return next();
    }

    const sessionId = getSessionIdFromUr(req.url);
    const proxyServer = getProxyServer();

    if (!sessionId) {
      return next();
    }

    await updateCmdExecutedTime(sessionId);

    req.headers['accept-encoding'] = 'deflate';

    const shouldInterceptRequest = isHub && !!SESSION_MANAGER.isValidSession(sessionId);
    const commandName = routeToCommandName(req.path, req.method as any, cliArgs['basePath']);

    // Always intercept DELETE requests to ensure onSessionStoped is called
    if (req.method === 'DELETE' || shouldInterceptRequest) {
      log.info(
        `Intercepting ${req.method} request for session ${sessionId}, shouldInterceptRequest: ${shouldInterceptRequest}`,
      );
      if (shouldInterceptRequest) {
        const shouldProceed = await DASHBORD_EVENT_MANAGER.beforeSessionCommand(
          sessionId,
          commandName,
          req,
          res,
        );
        if (!shouldProceed) {
          return;
        }
      }
      interceptResponse(sessionId, commandName, req, res);
    }

    if (remoteProxyMap.has(sessionId)) {
      if (proxyServer) {
        const response = await axios({
          method: req.method,
          url: new URL(req.path, new URL(remoteHostMap.get(sessionId)).origin).toString(),
          data: req.body,
          params: req.query,
          validateStatus: () => true,
          httpsAgent: new HttpsProxyAgent(proxyServer),
          httpAgent: new HttpProxyAgent(proxyServer),
          proxy: false,
        });
        res.status(response.status).json(response.data);
      } else {
        remoteProxyMap.get(sessionId)(req, res, next);
      }
      if (req.method === 'DELETE') {
        log.info(
          `📱 Unblocking the device that is blocked for session ${sessionId} in remote machine`,
        );
        unblockDeviceMatchingFilter({ session_id: sessionId });
        removeProxyHandler(sessionId);
      }
    } else {
      next();
    }
  };
}

async function interceptResponse(
  sessionId: string,
  commandName: string | undefined,
  req: Request,
  res: Response,
) {
  const [originalWrite, originalEnd] = [res.write, res.end];
  const chunks: Uint8Array[] = [];

  (res.write as unknown) = function (...args: any) {
    chunks.push(typeof args[0] === 'string' ? Buffer.from(args[0]) : args[0]);
    originalWrite.apply(res, args);
  };

  (res.end as unknown) = async function (...args: any) {
    if (args[0]) {
      chunks.push(typeof args[0] === 'string' ? Buffer.from(args[0]) : args[0]);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.method === 'DELETE') {
      log.info(`🔴 DELETE request intercepted, calling onSessionStoped for ${sessionId}`);
      await DASHBORD_EVENT_MANAGER.onSessionStoped(sessionId);
    } else {
      await DASHBORD_EVENT_MANAGER.afterSessionCommand(
        sessionId,
        commandName,
        null,
        req,
        res,
        body,
      );
    }

    originalEnd.apply(res, args);
  };
}

export function registerProxyMiddlware(expressApp: any, cliArgs: Record<string, any>) {
  log.info('Registering proxy middleware');
  // Ensure the router and stack exist; plugin code may be loaded before routes are added
  if (!expressApp || !expressApp._router || !Array.isArray(expressApp._router.stack)) {
    log.info('Express app router not initialized yet; attaching proxy as a normal middleware');
    expressApp.use('/', handler(cliArgs));
    return;
  }
  const index = expressApp._router.stack.findIndex((s: any) => s.route);
  expressApp.use('/', handler(cliArgs));
  // If index is not found, just push to the stack
  if (index === -1) {
    expressApp._router.stack.push(expressApp._router.stack.pop());
  } else {
    expressApp._router.stack.splice(index, 0, expressApp._router.stack.pop());
  }
}
