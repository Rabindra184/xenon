import { Proxy } from 'http-mitm-proxy';
import { CapturedRequest, RequestSummary } from './types';
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
}

export class MitmProxyHost {
  private proxy: Proxy | undefined;
  private logger = log.scope('MitmProxyHost');

  constructor(
    private readonly opts: ProxyHostOptions,
    private readonly mocks: MockEngine,
    private readonly sink: CaptureSink,
  ) {}

  async start(): Promise<void> {
    const proxy = new Proxy();
    this.proxy = proxy;

    proxy.onError((_ctx, err) => {
      this.logger.warn(`[${this.opts.sessionId}] proxy error: ${err?.message || err}`);
    });

    proxy.onRequest((ctx, callback) => this.handleRequest(ctx, callback));
    proxy.onRequestData((ctx, chunk, cb) => this.collectReqData(ctx, chunk, cb));
    proxy.onResponseData((ctx, chunk, cb) => this.collectResData(ctx, chunk, cb));
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
      const opts = ctx.proxyToServerRequestOptions;
      if (opts && matched.rewriteRequest.headers) {
        Object.assign(opts.headers, matched.rewriteRequest.headers);
      }
    }

    callback();
  }

  private collectReqData(
    ctx: any,
    chunk: Buffer,
    cb: (err?: Error | null, c?: Buffer) => void,
  ): void {
    if (!this.opts.captureBodies) return cb(null, chunk);
    const tx: PendingTransaction | undefined = ctx.tags?.xenonTx;
    if (tx) tx.reqBodyChunks.push(Buffer.from(chunk));
    cb(null, chunk);
  }

  private collectResData(
    ctx: any,
    chunk: Buffer,
    cb: (err?: Error | null, c?: Buffer) => void,
  ): void {
    if (!this.opts.captureBodies) return cb(null, chunk);
    const tx: PendingTransaction | undefined = ctx.tags?.xenonTx;
    if (tx) tx.resBodyChunks.push(Buffer.from(chunk));
    cb(null, chunk);
  }

  private finalize(ctx: any, cb: (err?: Error | null) => void): void {
    const tx: PendingTransaction | undefined = ctx.tags?.xenonTx;
    if (!tx) return cb();
    const upstream = ctx.serverToProxyResponse;
    const status = upstream?.statusCode ?? 0;
    const headers = this.normalizeHeaders(upstream?.headers || {});
    const reqBody =
      this.opts.captureBodies && tx.reqBodyChunks.length
        ? Buffer.concat(tx.reqBodyChunks).toString('utf8')
        : null;
    const resBody =
      this.opts.captureBodies && tx.resBodyChunks.length
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
