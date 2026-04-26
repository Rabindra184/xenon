import { Proxy } from 'http-mitm-proxy';
import {
  CapturedRequest,
  FailureKind,
  RequestSummary,
  RewriteRequest,
  RewriteResponse,
} from './types';
import { MockEngine } from './MockEngine';
import { randomUUID } from 'crypto';
import log from '../../logger';

export interface ProxyHostOptions {
  port: number;
  host: string;
  sslCaDir: string;
  sessionId: string;
  captureBodies: boolean;
}

export type CaptureSink = (entry: CapturedRequest) => void;

interface PendingTransaction {
  id: string;
  startedAt: number;
  reqHeaders: Record<string, string>;
  reqBodyChunks: Buffer[];
  resBodyChunks: Buffer[];
  url: string;
  host: string;
  path: string;
  method: string;
  mocked: boolean;
  modified: boolean;
  mockId?: string;
  rewriteRequestBody?: string;
  rewriteResponse?: RewriteResponse;
}

const RECENT_CONNECT_RING = 20;
const RECENT_CONNECT_TTL_MS = 30_000;

export class MitmProxyHost {
  private proxy: Proxy | undefined;
  private logger = log.scope('MitmProxyHost');
  // Tracks recent HTTPS CONNECT requests so we can attribute ctx-less TLS errors
  // (HTTPS_CLIENT_ERROR / HTTPS_SERVER_ERROR / ON_CONNECT_ERROR / OPEN_HTTPS_SERVER_ERROR
  // are all fired with ctx=null by http-mitm-proxy). `consumed` is flipped when an
  // entry is used to attribute an error so concurrent CONNECTs that all fail don't
  // collapse onto the single most-recent host — see handleProxyError.
  private recentConnects: Array<{ host: string; ts: number; consumed: boolean }> = [];
  // Dedupe key = `${host}|${errorKind}` — one stub capture per host-error combo per session.
  // Bounded in practice by host cardinality (realistically O(10–50) per session), so no
  // explicit eviction.
  private failedKeys: Set<string> = new Set();

  constructor(
    private readonly opts: ProxyHostOptions,
    private readonly mocks: MockEngine,
    private readonly sink: CaptureSink,
  ) {}

  async start(): Promise<void> {
    const proxy = new Proxy();
    this.proxy = proxy;

    proxy.onConnect((req: any, _socket: any, _head: any, callback: () => void) => {
      const host = String(req?.url || '').split(':')[0];
      if (host) {
        this.recentConnects.push({ host, ts: Date.now(), consumed: false });
        if (this.recentConnects.length > RECENT_CONNECT_RING) this.recentConnects.shift();
      }
      callback();
    });

    proxy.onError((ctx: any, err: any, errorKind?: string) => {
      this.logger.warn(
        `[${this.opts.sessionId}] proxy error (${errorKind || 'UNKNOWN'}): ${err?.message || err}`,
      );
      this.handleProxyError(ctx, err, errorKind || 'UNKNOWN');
    });

    proxy.onRequest((ctx, callback) => this.handleRequest(ctx, callback));
    // cb signature cast: passing null/undefined chunk drops it from the forward stream
    // — supported by http-mitm-proxy at runtime but the .d.ts is stricter than reality.
    proxy.onRequestData((ctx, chunk, cb) =>
      this.collectReqData(ctx, chunk, cb as (e?: Error | null, c?: Buffer | null) => void),
    );
    proxy.onResponse((ctx, cb) => this.handleResponse(ctx, cb));
    proxy.onResponseData((ctx, chunk, cb) =>
      this.collectResData(ctx, chunk, cb as (e?: Error | null, c?: Buffer | null) => void),
    );
    proxy.onResponseEnd((ctx, cb) => this.finalize(ctx, cb));

    await new Promise<void>((resolve, reject) => {
      try {
        proxy.listen(
          {
            port: this.opts.port,
            host: '0.0.0.0',
            sslCaDir: this.opts.sslCaDir,
          },
          () => resolve(),
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.proxy) return;
    try {
      this.proxy.close();
    } catch (e) {
      /* ignore */
    }
    this.proxy = undefined;
  }

  private handleRequest(ctx: any, callback: (err?: Error | null) => void): void {
    const req = ctx.clientToProxyRequest;
    const isSSL = ctx.isSSL;
    const host = req.headers.host || '';
    const protocol = isSSL ? 'https' : 'http';
    const url = `${protocol}://${host}${req.url || ''}`;
    const path = req.url || '';

    const tx: PendingTransaction = {
      id: randomUUID(),
      startedAt: Date.now(),
      reqHeaders: this.normalizeHeaders(req.headers),
      reqBodyChunks: [],
      resBodyChunks: [],
      url,
      host: host.split(':')[0],
      path,
      method: req.method || 'GET',
      mocked: false,
      modified: false,
    };
    ctx.tags = ctx.tags || ({} as any);
    (ctx.tags as any).xenonTx = tx;

    const summary: RequestSummary = {
      method: tx.method,
      url: tx.url,
      headers: tx.reqHeaders,
    };
    const matched = this.mocks.match(summary);
    if (matched?.respondWith) {
      tx.mocked = true;
      tx.mockId = matched.id;
      const r = matched.respondWith;
      const body = this.serializeBody(r.body);
      const headers = { 'content-type': 'application/json', ...(r.headers || {}) };

      const send = () => {
        const res = ctx.proxyToClientResponse;
        try {
          res.writeHead(r.status, headers);
          if (body) res.end(body);
          else res.end();
        } catch (e) {
          this.logger.warn(`[${this.opts.sessionId}] write mock failed: ${(e as Error).message}`);
        }
        tx.resBodyChunks = body ? [Buffer.from(body)] : [];
        this.emitFromMock(tx, r.status, headers);
      };

      if (r.delayMs && r.delayMs > 0) setTimeout(send, r.delayMs);
      else send();
      return;
    }

    if (matched?.rewriteRequest) {
      tx.modified = true;
      tx.mockId = matched.id;
      this.applyRewriteRequest(ctx, tx, matched.rewriteRequest);
    }

    if (matched?.rewriteResponse) {
      tx.modified = true;
      tx.mockId = matched.id;
      tx.rewriteResponse = matched.rewriteResponse;
    }

    callback();
  }

  private applyRewriteRequest(ctx: any, tx: PendingTransaction, rewrite: RewriteRequest): void {
    const opts = ctx.proxyToServerRequestOptions;
    if (opts && rewrite.headers) {
      Object.assign(opts.headers, rewrite.headers);
    }

    if (rewrite.body == null) return;

    const replacement = this.serializeBody(rewrite.body) ?? '';
    tx.rewriteRequestBody = replacement;

    if (opts) {
      opts.headers = opts.headers || {};
      opts.headers['content-length'] = Buffer.byteLength(replacement);
      const hasContentType = Object.keys(opts.headers).some(
        (k) => k.toLowerCase() === 'content-type',
      );
      if (!hasContentType) opts.headers['content-type'] = 'application/json';
    }

    ctx.onRequestData((_ctx: any, _chunk: any, cb: any) => cb(null, null));
    let written = false;
    ctx.onRequestEnd((c: any, cb: any) => {
      if (!written) {
        written = true;
        try {
          c.proxyToServerRequest?.write(replacement);
        } catch (e) {
          this.logger.warn(
            `[${this.opts.sessionId}] write rewriteRequest body failed: ${(e as Error).message}`,
          );
        }
      }
      cb();
    });
  }

  // Visible for tests.
  handleResponse(ctx: any, cb: (err?: Error | null) => void): void {
    const tx: PendingTransaction | undefined = ctx.tags?.xenonTx;
    const rewrite = tx?.rewriteResponse;
    if (!tx || !rewrite) return cb();

    const upstream = ctx.serverToProxyResponse;
    if (upstream) {
      if (rewrite.status != null) upstream.statusCode = rewrite.status;
      if (rewrite.headers) {
        upstream.headers = upstream.headers || {};
        for (const k of Object.keys(rewrite.headers)) {
          upstream.headers[k.toLowerCase()] = rewrite.headers[k];
        }
      }
      // Body length will change; let chunked encoding handle framing.
      if (rewrite.body != null || rewrite.bodyTransform) {
        if (upstream.headers) delete upstream.headers['content-length'];
      }
    }
    cb();
  }

  private collectReqData(
    ctx: any,
    chunk: Buffer,
    cb: (err?: Error | null, c?: Buffer | null) => void,
  ): void {
    const tx: PendingTransaction | undefined = ctx.tags?.xenonTx;
    // When the request body is being rewritten the original chunks are dropped here so
    // they don't get captured (the replacement is captured in finalize); the per-ctx
    // onRequestData handler set up in applyRewriteRequest is what stops them reaching
    // the upstream server.
    if (tx?.rewriteRequestBody != null) return cb(null, null);
    if (!this.opts.captureBodies) return cb(null, chunk);
    if (tx) tx.reqBodyChunks.push(Buffer.from(chunk));
    cb(null, chunk);
  }

  private collectResData(
    ctx: any,
    chunk: Buffer,
    cb: (err?: Error | null, c?: Buffer | null) => void,
  ): void {
    const tx: PendingTransaction | undefined = ctx.tags?.xenonTx;
    const rewriting =
      tx?.rewriteResponse != null &&
      (tx.rewriteResponse.body != null || tx.rewriteResponse.bodyTransform != null);
    if (rewriting && tx) {
      // Always buffer the upstream body for jsonMerge, even when captureBodies is off,
      // because the transform needs to read it.
      tx.resBodyChunks.push(Buffer.from(chunk));
      return cb(null, null);
    }
    if (!this.opts.captureBodies) return cb(null, chunk);
    if (tx) tx.resBodyChunks.push(Buffer.from(chunk));
    cb(null, chunk);
  }

  private finalize(ctx: any, cb: (err?: Error | null) => void): void {
    const tx: PendingTransaction | undefined = ctx.tags?.xenonTx;
    if (!tx) return cb();

    // Apply response body rewrite — happens before we read resBodyChunks for capture so
    // the captured entry reflects what the client actually saw, not the upstream body.
    if (
      tx.rewriteResponse &&
      (tx.rewriteResponse.body != null || tx.rewriteResponse.bodyTransform != null)
    ) {
      const original = tx.resBodyChunks.length
        ? Buffer.concat(tx.resBodyChunks).toString('utf8')
        : '';
      const transformed = MitmProxyHost.applyResponseBodyTransform(tx.rewriteResponse, original);
      try {
        ctx.proxyToClientResponse?.write(transformed);
      } catch (e) {
        this.logger.warn(
          `[${this.opts.sessionId}] write rewriteResponse body failed: ${(e as Error).message}`,
        );
      }
      tx.resBodyChunks = [Buffer.from(transformed)];
    }

    // For request-body rewrite, capture the replacement (original chunks were dropped
    // in collectReqData).
    if (tx.rewriteRequestBody != null) {
      tx.reqBodyChunks = [Buffer.from(tx.rewriteRequestBody)];
    }

    const upstream = ctx.serverToProxyResponse;
    const status = upstream?.statusCode ?? 0;
    const headers = this.normalizeHeaders(upstream?.headers || {});
    const captureReq = this.opts.captureBodies || tx.rewriteRequestBody != null;
    const captureRes = this.opts.captureBodies || tx.rewriteResponse != null;
    const reqBody =
      captureReq && tx.reqBodyChunks.length
        ? Buffer.concat(tx.reqBodyChunks).toString('utf8')
        : null;
    const resBody =
      captureRes && tx.resBodyChunks.length
        ? Buffer.concat(tx.resBodyChunks).toString('utf8')
        : null;

    const entry: CapturedRequest = {
      id: tx.id,
      sessionId: this.opts.sessionId,
      ts: tx.startedAt,
      method: tx.method,
      url: tx.url,
      host: tx.host,
      path: tx.path,
      reqHeaders: tx.reqHeaders,
      reqBody,
      resStatus: status,
      resHeaders: headers,
      resBody,
      durationMs: Date.now() - tx.startedAt,
      mocked: tx.mocked,
      modified: tx.modified,
      mockId: tx.mockId,
    };
    this.sink(entry);
    cb();
  }

  private emitFromMock(
    tx: PendingTransaction,
    status: number,
    headers: Record<string, string>,
  ): void {
    const resBody = tx.resBodyChunks.length
      ? Buffer.concat(tx.resBodyChunks).toString('utf8')
      : null;
    const entry: CapturedRequest = {
      id: tx.id,
      sessionId: this.opts.sessionId,
      ts: tx.startedAt,
      method: tx.method,
      url: tx.url,
      host: tx.host,
      path: tx.path,
      reqHeaders: tx.reqHeaders,
      reqBody: null,
      resStatus: status,
      resHeaders: headers,
      resBody,
      durationMs: Date.now() - tx.startedAt,
      mocked: true,
      modified: false,
      mockId: tx.mockId,
    };
    this.sink(entry);
  }

  // Visible for tests.
  handleProxyError(ctx: any, err: any, errorKind: string): void {
    const reason = MitmProxyHost.classifyError(err, errorKind);
    if (!reason) return;
    const kind = errorKind as FailureKind;

    let host = '';
    const ctxHost = ctx?.clientToProxyRequest?.headers?.host;
    if (ctxHost) {
      host = String(ctxHost).split(':')[0];
    } else {
      // ctx-less error path (e.g. HTTPS_CLIENT_ERROR — TLS handshake rejected by app).
      // Walk the ring from most-recent → oldest, skipping entries already consumed by
      // a previous error, and attribute to the first live entry inside the TTL window.
      // This is heuristic: errors and CONNECTs aren't strictly LIFO across concurrent
      // pipelines, so attribution may still be off when many CONNECTs interleave with
      // many failures, but it's strictly better than always picking the newest.
      const now = Date.now();
      for (let i = this.recentConnects.length - 1; i >= 0; i--) {
        const c = this.recentConnects[i];
        if (c.consumed) continue;
        if (now - c.ts > RECENT_CONNECT_TTL_MS) continue;
        host = c.host;
        c.consumed = true;
        break;
      }
    }
    if (!host) return;

    const key = `${host}|${errorKind}`;
    if (this.failedKeys.has(key)) return;
    this.failedKeys.add(key);

    const entry: CapturedRequest = {
      id: randomUUID(),
      sessionId: this.opts.sessionId,
      ts: Date.now(),
      method: 'CONNECT',
      url: `https://${host}`,
      host,
      path: '',
      reqHeaders: {},
      reqBody: null,
      resStatus: -1,
      resHeaders: {},
      resBody: null,
      durationMs: 0,
      mocked: false,
      modified: false,
      failed: true,
      failureReason: reason,
      failureKind: kind,
    };
    this.sink(entry);
  }

  // Visible for tests. Pure transform: produces the body that should replace the
  // upstream response body. `original` is the upstream response body as utf8.
  // - bodyTransform 'jsonMerge': shallow-merge a JSON patch object onto the parsed
  //   original; if the original is not parseable JSON, fall through to replace.
  // - bodyTransform 'replace' (or unset, with body provided): emit body as-is
  //   (string) or JSON-stringified (object).
  // - body unset: return original unchanged.
  static applyResponseBodyTransform(rewrite: RewriteResponse, original: string): string {
    if (rewrite.body == null && !rewrite.bodyTransform) return original;

    if (rewrite.bodyTransform === 'jsonMerge' && rewrite.body != null) {
      let origObj: any = null;
      try {
        origObj = original ? JSON.parse(original) : {};
      } catch {
        origObj = null;
      }
      if (origObj && typeof origObj === 'object') {
        const patch =
          typeof rewrite.body === 'string'
            ? (safeJsonParse(rewrite.body) ?? rewrite.body)
            : rewrite.body;
        if (patch && typeof patch === 'object') {
          return JSON.stringify({ ...origObj, ...(patch as Record<string, any>) });
        }
      }
      // Fall through: original wasn't object-shaped, behave as 'replace'.
    }

    if (rewrite.body == null) return original;
    return typeof rewrite.body === 'string' ? rewrite.body : JSON.stringify(rewrite.body);
  }

  // Visible for tests. Returns null for kinds we don't surface.
  static classifyError(err: any, errorKind: string): string | null {
    switch (errorKind) {
      case 'HTTPS_CLIENT_ERROR':
        return 'HTTPS handshake rejected by app — proxy cert is not trusted (Android 7+ apps must opt in via network_security_config.xml)';
      case 'HTTPS_SERVER_ERROR':
        return 'HTTPS server-side error during TLS handshake';
      case 'OPEN_HTTPS_SERVER_ERROR':
        return 'Failed to open HTTPS endpoint for host';
      case 'ON_CONNECT_ERROR':
        return 'CONNECT tunnel could not be established';
      case 'PROXY_TO_SERVER_REQUEST_ERROR': {
        const code = err?.code;
        if (code === 'ENOTFOUND') return 'DNS lookup failed';
        if (code === 'ECONNREFUSED') return 'Upstream connection refused';
        if (code === 'ETIMEDOUT') return 'Upstream connection timed out';
        return `Upstream connection failed${code ? ` (${String(code)})` : ''}`;
      }
      default:
        return null;
    }
  }

  private normalizeHeaders(h: Record<string, any>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of Object.keys(h)) {
      const v = h[k];
      out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return out;
  }

  private serializeBody(body: unknown): string | null {
    if (body == null) return null;
    if (typeof body === 'string') return body;
    return JSON.stringify(body);
  }
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
