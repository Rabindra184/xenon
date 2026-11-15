import http from 'http';
import net from 'net';
import express, { Router } from 'express';
import type { McpCaller } from './mcpCredential';

/**
 * Where the caller of a request `invokeApi` made is kept, on that request
 * object. A symbol, so nothing a network request carries can set it: no
 * header, query or body becomes a symbol-keyed property. authMiddleware takes
 * it as the request's caller, and csrfMiddleware lets it through (a request
 * made in process is no browser's).
 */
export const PRESET_CALLER: unique symbol = Symbol('xenon.mcp.presetCaller');

/** The MCP caller of a request a tool made, or undefined for any other request. */
export function mcpContextOf(req: object): McpCaller | undefined {
  return (req as { [PRESET_CALLER]?: McpCaller })[PRESET_CALLER];
}

/** Where the API router is mounted, as on the plugin's server. */
const API_MOUNT = '/xenon/api';

/** The app tools dispatch through: the `/xenon/api` router at its usual path. */
let api: express.Express | undefined;

/**
 * Set the `/xenon/api` router tools run their routes through (src/app/index.ts,
 * once, with the router createRouter fills). The query is read as Appium 3's
 * Express 5 reads it ('simple'), since that is the app the router runs in.
 */
export function serveToolsFrom(apiRouter: Router): void {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(API_MOUNT, apiRouter);
  api = app;
}

export interface ApiCall {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  /** Under `/xenon/api`, with any path segments already encoded. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiAnswer {
  status: number;
  /** The JSON answer parsed, else its text; undefined for none. */
  body: any;
}

/**
 * Runs a `/xenon/api` route in process, as `caller`, and gives back its
 * status and body. No socket and no HTTP: the request goes through the API
 * router's own middleware (CSRF, the login, the rate limit) and routes, so
 * the route's team, ownership and scope rules, and its answers, are REST's.
 * The login takes the preset caller and reads no credential.
 */
export function invokeApi(caller: McpCaller, call: ApiCall): Promise<ApiAnswer> {
  const app = api;
  if (!app) return Promise.reject(new Error('The /xenon/api router is not set up.'));

  const socket = new net.Socket();
  const req = new http.IncomingMessage(socket);
  req.method = call.method;
  req.url = API_MOUNT + call.path + queryString(call.query);
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  req.headers = { host: 'localhost', ...lowerCased(call.headers) };
  if (call.body !== undefined) req.headers['content-type'] = 'application/json';
  // Parsed already, as body-parser marks it (`_body`), so no parser reads the
  // stream; it is ended for any code that waits for its end.
  Object.assign(req, { body: call.body ?? {}, _body: true, [PRESET_CALLER]: caller });
  req.push(null);
  req.complete = true;

  const res = new http.ServerResponse(req);
  return new Promise<ApiAnswer>((resolve, reject) => {
    collectAnswer(res, (answer) => {
      socket.destroy();
      resolve(answer);
    });
    try {
      app(req as express.Request, res as express.Response);
    } catch (err) {
      socket.destroy();
      reject(err);
    }
  });
}

function queryString(query: Record<string, string> | undefined): string {
  if (!query) return '';
  const text = new URLSearchParams(query).toString();
  return text ? `?${text}` : '';
}

function lowerCased(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) out[name.toLowerCase()] = value;
  return out;
}

type Callback = (err?: Error | null) => void;

/**
 * Keeps what the route writes instead of sending it anywhere, and calls
 * `done` once the response has ended. `write` and `end` are the response's
 * own properties: Express swaps the response's prototype for its own.
 */
function collectAnswer(res: http.ServerResponse, done: (answer: ApiAnswer) => void): void {
  const chunks: Buffer[] = [];
  const keep = (chunk: unknown, encoding: unknown) => {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(
            String(chunk),
            (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding,
          ),
    );
  };
  const startHeaders = () => {
    if (!res.headersSent) res.writeHead(res.statusCode);
  };

  res.write = function write(chunk: unknown, encoding?: unknown, cb?: unknown): boolean {
    startHeaders();
    keep(chunk, encoding);
    const callback = typeof encoding === 'function' ? encoding : cb;
    if (typeof callback === 'function') process.nextTick(callback as Callback);
    return true;
  } as typeof res.write;

  res.end = function end(chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (res.writableEnded) return res;
    startHeaders();
    keep(chunk, encoding);
    res.finished = true;
    const callback = [chunk, encoding, cb].find((a) => typeof a === 'function');
    process.nextTick(() => {
      res.emit('prefinish');
      res.emit('finish');
      res.emit('close');
      if (callback) (callback as Callback)();
      done({ status: res.statusCode, body: bodyOf(res, Buffer.concat(chunks)) });
    });
    return res;
  } as typeof res.end;
}

function bodyOf(res: http.ServerResponse, raw: Buffer): unknown {
  if (raw.length === 0) return undefined;
  const text = raw.toString('utf8');
  const type = String(res.getHeader('content-type') ?? '');
  if (!/\bjson\b/i.test(type)) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
