import http from 'http';
import net from 'net';
import express, { Router } from 'express';
import type { McpCaller } from './mcpCredential';
import { ToolRefusal } from './toolRefusal';

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
 * once, with the router createRouter fills; it returns a function that puts
 * back the router served before). The query is read as Appium 3's
 * Express 5 reads it ('simple'), since that is the app the router runs in.
 */
export function serveToolsFrom(apiRouter: Router): () => void {
  const before = api;
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(API_MOUNT, apiRouter);
  api = app;
  /** Puts back the router served before (for a spec that serves its own). */
  return () => {
    api = before;
  };
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

/** How long a tool's REST route may take before the tool gives up on it. */
export const API_CALL_TIMEOUT_MS = 30_000;

/**
 * Runs a `/xenon/api` route in process, as `caller`, and gives back its
 * status and body. No socket and no HTTP: the request goes through the API
 * router's own middleware (CSRF, the login, the rate limit) and routes, so
 * the route's team, ownership and scope rules, and its answers, are REST's.
 * The login takes the preset caller and reads no credential.
 *
 * A route that hasn't answered in API_CALL_TIMEOUT_MS is a ToolRefusal
 * `timeout`, and the request is ended as a client that leaves ends one.
 */
export function invokeApi(
  caller: McpCaller,
  call: ApiCall,
  opts: { timeoutMs?: number } = {},
): Promise<ApiAnswer> {
  const app = api;
  if (!app) return Promise.reject(new Error('The /xenon/api router is not set up.'));
  return dispatchInProcess(
    app,
    caller,
    {
      method: call.method,
      url: API_MOUNT + call.path + queryString(call.query),
      body: call.body,
      headers: call.headers,
    },
    { timeoutMs: opts.timeoutMs ?? API_CALL_TIMEOUT_MS, what: `${call.method} ${call.path}` },
  );
}

/** One request made in process, as dispatchInProcess sends it. */
export interface InProcessRequest {
  method: string;
  /** The path from the app's root, query string included. */
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Sends one request through an Express app in process, `caller` preset on the
 * request object (PRESET_CALLER), and resolves with what the app answered.
 * The body is handed over already parsed, as body-parser leaves it, so no
 * parser reads the stream.
 *
 * After `timeoutMs` with no answer it rejects with a ToolRefusal `timeout`
 * (`what` names the call in its message) and ends the request: the request
 * and response emit `close`, as for a client that went away, so a route that
 * waits on them (a long-poll, a hub's forward to a node) stops, and whatever
 * the route writes later goes nowhere.
 */
export function dispatchInProcess(
  app: (req: any, res: any) => unknown,
  caller: McpCaller,
  request: InProcessRequest,
  opts: { timeoutMs: number; what: string },
): Promise<ApiAnswer> {
  const socket = new net.Socket();
  const req = new http.IncomingMessage(socket);
  req.method = request.method;
  req.url = request.url;
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  req.headers = { host: 'localhost', ...lowerCased(request.headers) };
  if (request.body !== undefined) req.headers['content-type'] = 'application/json';
  // Parsed already, as body-parser marks it (`_body`), so no parser reads the
  // stream; it is ended for any code that waits for its end.
  Object.assign(req, { body: request.body ?? {}, _body: true, [PRESET_CALLER]: caller });
  req.push(null);
  req.complete = true;

  const res = new http.ServerResponse(req);
  return new Promise<ApiAnswer>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      settle(() => {
        endAbandoned(req, res, socket);
        reject(
          new ToolRefusal(
            'timeout',
            `${opts.what} did not answer within ${Math.round(opts.timeoutMs / 1000)} s.`,
            504,
          ),
        );
      });
    }, opts.timeoutMs);
    collectAnswer(res, (answer) =>
      settle(() => {
        socket.destroy();
        resolve(answer);
      }),
    );
    try {
      app(req, res);
    } catch (err) {
      settle(() => {
        socket.destroy();
        reject(err);
      });
    }
  });
}

/**
 * A request given up on: closed as a client that leaves closes one. Its
 * response is marked ended first, so the route's own `close` handlers see a
 * response that wasn't finished by them (it never was) and a later write is
 * dropped.
 */
function endAbandoned(req: http.IncomingMessage, res: http.ServerResponse, socket: net.Socket) {
  (res as { [ABANDONED]?: boolean })[ABANDONED] = true;
  req.emit('aborted');
  req.emit('close');
  res.emit('close');
  socket.destroy();
}

const ABANDONED = Symbol('xenon.mcp.abandoned');

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

  const abandoned = () => (res as { [ABANDONED]?: boolean })[ABANDONED] === true;

  res.write = function write(chunk: unknown, encoding?: unknown, cb?: unknown): boolean {
    if (abandoned()) return false;
    startHeaders();
    keep(chunk, encoding);
    const callback = typeof encoding === 'function' ? encoding : cb;
    if (typeof callback === 'function') process.nextTick(callback as Callback);
    return true;
  } as typeof res.write;

  res.end = function end(chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (res.writableEnded || abandoned()) return res;
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
