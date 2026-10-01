import http from 'http';
import https from 'https';
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'http';
import type { Readable } from 'stream';
import type { Response } from 'express';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { INTERNAL_CALL_HEADER } from './internalCall';
import { HUB_TOKEN_HEADER } from './hubSessionToken';

/**
 * Sending a session command on to the node that runs the session, and handing
 * the node's answer back to the client unchanged.
 */

// Hop-by-hop headers describe one connection, not the message. `host` and
// `content-length` are recomputed for the hop to the node.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

// The client's credentials were checked here and are not the node's business:
// the node trusts the hub's session token instead. Xenon's own markers are
// never taken from a client.
const NEVER_FORWARDED = new Set([
  'authorization',
  'cookie',
  'x-xenon-access-key',
  'x-xenon-token',
  INTERNAL_CALL_HEADER,
  HUB_TOKEN_HEADER,
]);

export function forwardedRequestHeaders(incoming: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(lower) || NEVER_FORWARDED.has(lower)) continue;
    out[lower] = value;
  }
  // The answer is relayed byte for byte and read for the dashboard's command
  // log, so ask for it uncompressed.
  out['accept-encoding'] = 'identity';
  return out;
}

/** HTTP(S)_PROXY from the environment, as the old command proxy honoured it. */
function proxyAgentFor(url: URL): http.Agent | undefined {
  const proxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (!proxy) return undefined;
  return url.protocol === 'https:' ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy);
}

export interface NodeRequest {
  url: string;
  method: string;
  headers: OutgoingHttpHeaders;
  /** Sent whole, or streamed (an upload), with its length in `headers` if known. */
  body?: Buffer | Readable;
  signal?: AbortSignal;
}

/**
 * Send one request to a node and resolve with its response stream. No retry:
 * a WebDriver command is not safe to repeat. Credentials in the URL (a cloud
 * provider's) become basic auth.
 */
export function sendToNode(request: NodeRequest): Promise<IncomingMessage> {
  const url = new URL(request.url);
  const lib = url.protocol === 'https:' ? https : http;
  const headers: OutgoingHttpHeaders = { ...request.headers };
  const body = request.body;
  if (Buffer.isBuffer(body)) headers['content-length'] = body.length;
  return new Promise((resolve, reject) => {
    const outgoing = lib.request(
      url,
      { method: request.method, headers, agent: proxyAgentFor(url), signal: request.signal },
      resolve,
    );
    outgoing.on('error', reject);
    if (body && !Buffer.isBuffer(body)) {
      body.on('error', (err) => outgoing.destroy(err));
      body.pipe(outgoing);
    } else {
      outgoing.end(body);
    }
  });
}

function copyResponseHeaders(upstream: IncomingMessage, res: Response): void {
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
    res.setHeader(name, value);
  }
  if (upstream.headers['content-length'] !== undefined) {
    res.setHeader('content-length', upstream.headers['content-length']);
  }
}

/**
 * Stream the node's answer to the client: its status, its headers (less the
 * hop-by-hop ones) and its body, unchanged. With `capture`, also resolve with
 * the body as text, for the dashboard's command log.
 */
export function relayAnswer(
  upstream: IncomingMessage,
  res: Response,
  capture: boolean,
): Promise<string | undefined> {
  res.status(upstream.statusCode ?? 502);
  copyResponseHeaders(upstream, res);
  const chunks: Buffer[] | undefined = capture ? [] : undefined;
  return new Promise((resolve, reject) => {
    if (chunks) upstream.on('data', (chunk: Buffer) => chunks.push(chunk));
    upstream.on('end', () => resolve(chunks ? Buffer.concat(chunks).toString('utf8') : undefined));
    upstream.on('error', reject);
    upstream.pipe(res);
  });
}

export interface NodeAnswer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** Read a whole answer, for a caller that must act before replying (DELETE). */
export function readAnswer(upstream: IncomingMessage): Promise<NodeAnswer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    upstream.on('data', (chunk: Buffer) => chunks.push(chunk));
    upstream.on('end', () =>
      resolve({
        status: upstream.statusCode ?? 502,
        headers: upstream.headers,
        body: Buffer.concat(chunks),
      }),
    );
    upstream.on('error', reject);
  });
}

export function sendAnswer(res: Response, answer: NodeAnswer): void {
  res.status(answer.status);
  for (const [name, value] of Object.entries(answer.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
    res.setHeader(name, value);
  }
  res.setHeader('content-length', answer.body.length);
  res.end(answer.body);
}

/** WebDriver's `unknown error`, for a node that could not be reached. */
export const NODE_UNREACHABLE_STATUS = 500;
export const NODE_UNREACHABLE_BODY = {
  value: {
    error: 'unknown error',
    message: 'Xenon could not reach the node running this session.',
    stacktrace: '',
  },
} as const;
