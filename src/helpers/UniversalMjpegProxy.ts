import { Request, Response } from 'express';
import http from 'http';
import net from 'net';
import { URL } from 'url';
import log from '../logger';

/**
 * Universal MJPEG Proxy
 *
 * Principal Design: Handling WDA's inconsistent MJPEG behavior.
 * Some WDA versions/configurations send standard HTTP MJPEG streams,
 * while others (especially over high-performance ports) might send raw boundaries
 * without the initial HTTP/1.1 response status line.
 *
 * This proxy sniffs high-level response headers and gracefully handles raw streams
 * by injecting consistent HTTP headers for the client browser.
 */
/**
 * Decide whether a per-device MJPEG proxy cache must create a fresh proxy.
 *
 * Recreate when: (a) nothing is cached, (b) the upstream url changed, or
 * (c) the cached proxy is stopped. Case (c) is the fix for the iOS preview
 * "503 forever" bug — a proxy that exhausted its retries and called stop()
 * stays in the cache, and because the upstream url is unchanged (same mjpeg
 * port) the old url-only check reused the dead object, 503-ing every request
 * even after WDA fully recovered.
 */
export function shouldRecreateMjpegProxy(
  existing: { url: string; stopped: boolean } | undefined | null,
  videoUrl: string,
): boolean {
  if (!existing) return true;
  if (existing.url !== videoUrl) return true;
  if (existing.stopped) return true;
  return false;
}

/**
 * Where the proxy's one upstream connection stands:
 * - `idle`: none, and none wanted (no viewer). The only state a new source
 *   is opened from, besides a backoff's timer.
 * - `connecting`: one source is being opened; viewers wait for it.
 * - `connected`: the source answers and its bytes go to every viewer.
 * - `backoff`: the source failed with viewers left; one timer opens the next.
 * - `stopped`: for good (stop(), or the retries ran out).
 */
export type MjpegProxyState = 'idle' | 'connecting' | 'connected' | 'backoff' | 'stopped';

export class UniversalMjpegProxy {
  private mjpegUrl: string;
  private boundary = 'BoundaryString';
  private globalResponseHeaders: any = {
    'Cache-Control':
      'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0',
    Pragma: 'no-cache',
    Connection: 'keep-alive',
    Expires: '0',
    'Content-Type': 'multipart/x-mixed-replace; boundary="BoundaryString"',
    'Access-Control-Allow-Origin': '*',
  };

  /** Viewers being served. */
  private clients: Set<Response> = new Set();
  /** Viewers waiting for the source to connect. They count as watching. */
  private waiting: Set<Response> = new Set();
  private state: MjpegProxyState = 'idle';
  /** The one open source (HTTP request or raw socket), while connecting or connected. */
  private source: { abort: () => void } | null = null;
  /**
   * Bumped whenever a source is opened or let go. Each source's callbacks
   * hold the value it was opened with and are ignored once it changes, so a
   * source that was let go (or replaced by the raw fallback) can never move
   * the proxy again.
   */
  private sourceGeneration = 0;
  private reconnectionTimeout: NodeJS.Timeout | null = null;

  /**
   * Principal Resilience: Retry limits with exponential backoff.
   * Without these, the proxy retries every 500ms FOREVER, flooding logs
   * and wasting CPU after a session ends or the server shuts down.
   */
  private consecutiveRetries = 0;
  private static readonly MAX_RETRIES = 10;
  private static readonly BASE_RETRY_MS = 500;
  private static readonly MAX_RETRY_MS = 10000;
  /** How long a new viewer waits for the source before a 503. */
  private static readonly CONNECT_WAIT_MS = 10000;

  // Drop a client whose kernel send buffer exceeds this. MJPEG frames must not be
  // split mid-boundary, so we drop the whole client rather than partial chunks —
  // otherwise a single paused browser tab silently queues frames in Node's heap
  // until the process OOMs on a long session.
  private static readonly MAX_CLIENT_BACKLOG_BYTES = 4 * 1024 * 1024;

  constructor(mjpegUrl: string) {
    this.mjpegUrl = mjpegUrl;
  }

  public get url(): string {
    return this.mjpegUrl;
  }

  /**
   * True once this proxy has permanently torn itself down (explicit stop() or
   * MAX_RETRIES exhausted). A stopped proxy can never reconnect — every
   * proxyRequest short-circuits to 503 — so cache holders must evict + recreate
   * rather than reuse it. See shouldRecreateMjpegProxy.
   */
  public get stopped(): boolean {
    return this.state === 'stopped';
  }

  /** Where the upstream connection stands (see MjpegProxyState). */
  public get sourceState(): MjpegProxyState {
    return this.state;
  }

  /** Neither serving nor stopped: a viewer still has something to wait for. */
  private sourcePending(): boolean {
    return this.state !== 'connected' && this.state !== 'stopped';
  }

  private get viewers(): number {
    return this.clients.size + this.waiting.size;
  }

  public async proxyRequest(req: Request, res: Response) {
    if (this.state === 'stopped') {
      if (!res.headersSent) res.status(503).send('[MjpegProxy] Source not available');
      return;
    }

    // Listen for the viewer leaving before anything else, so one who hangs up
    // while the source connects is never added afterwards, and the source is
    // let go if nobody else watches.
    let gone = false;
    req.once('close', () => {
      gone = true;
      this.removeClient(res);
    });

    // Principal Improvement: Delay headers until connected.
    // This ensures the browser's <img> tag stays in 'loading' state (and thus the frontend
    // keeps showing the spinner) until we actually have a source to proxy.
    if (this.state !== 'connected') {
      this.waiting.add(res);
      // One source at a time: only an idle proxy opens one. A viewer arriving
      // while it connects, or during a backoff, waits for that one.
      if (this.state === 'idle') this.transition('connecting');
      const start = Date.now();
      while (
        !gone &&
        this.sourcePending() &&
        Date.now() - start < UniversalMjpegProxy.CONNECT_WAIT_MS
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      this.waiting.delete(res);
    }

    if (gone) return;
    if (this.state !== 'connected') {
      if (!res.headersSent) {
        res.status(503).send('[MjpegProxy] Source not available after timeout');
      }
      // This viewer is no longer waiting: let the source go if nobody is.
      this.releaseIfUnwatched();
      return;
    }

    res.writeHead(200, this.globalResponseHeaders);
    this.clients.add(res);

    log.debug(
      `[MjpegProxy] New client joined stream: ${this.mjpegUrl}. Total clients: ${this.clients.size}`,
    );
  }

  /** The one way a viewer leaves: served or waiting, its going may end the source. */
  private removeClient(res: Response): void {
    const wasClient = this.clients.delete(res);
    const wasWaiting = this.waiting.delete(res);
    if (wasClient) log.debug(`[MjpegProxy] Client left stream. Remaining: ${this.clients.size}`);
    if (wasClient || wasWaiting) this.releaseIfUnwatched();
  }

  /** Let the source go, and any backoff timer, once nobody watches. */
  private releaseIfUnwatched(): void {
    if (this.viewers > 0) return;
    if (this.state === 'connecting' || this.state === 'connected' || this.state === 'backoff') {
      this.transition('idle', 'no active clients');
    }
  }

  /**
   * The one place the state changes. Leaving `connecting` or `connected` for
   * anything but `connected` lets the source go; leaving `backoff` clears its
   * timer; entering `connecting` opens the source. `stopped` is final.
   */
  private transition(next: MjpegProxyState, reason = 'intentional'): void {
    const prev = this.state;
    if (prev === 'stopped' || prev === next) return;

    const hadSource = prev === 'connecting' || prev === 'connected';
    if (hadSource && next !== 'connected') {
      log.info(`[MjpegProxy] Stopping source (${reason}): ${this.mjpegUrl}`);
      this.dropSource();
    }
    if (prev === 'backoff' && this.reconnectionTimeout) {
      clearTimeout(this.reconnectionTimeout);
      this.reconnectionTimeout = null;
    }

    this.state = next;
    if (next === 'connecting') this.openSource();
  }

  private dropSource(): void {
    const source = this.source;
    this.source = null;
    this.sourceGeneration += 1;
    try {
      source?.abort();
    } catch (e) {
      /* ignore */
    }
  }

  /** Whether the source opened as `generation` is still the proxy's. */
  private isCurrentSource(generation: number): boolean {
    return (
      generation === this.sourceGeneration &&
      (this.state === 'connecting' || this.state === 'connected')
    );
  }

  /** The source answered. With nobody left to serve, it goes straight away. */
  private sourceConnected(): void {
    this.consecutiveRetries = 0; // Reset on successful connection
    if (this.viewers === 0) {
      this.transition('idle', 'no active clients');
      return;
    }
    this.transition('connected');
  }

  private openSource() {
    const generation = ++this.sourceGeneration;
    const url = new URL(this.mjpegUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      // Its own connection, closed when the source is let go, never a pooled
      // keep-alive socket.
      agent: false as const,
    };

    log.info(`[MjpegProxy] Connecting to source: ${this.mjpegUrl}`);

    const request = http.get(options, (sourceRes) => {
      if (!this.isCurrentSource(generation)) {
        sourceRes.destroy();
        return;
      }
      if (sourceRes.statusCode !== 200) {
        log.error(`[MjpegProxy] Source returned non-200 status: ${sourceRes.statusCode}`);
        sourceRes.resume();
        this.sourceFailed();
        return;
      }

      // Standard MJPEG
      sourceRes.on('data', (chunk) => {
        if (this.isCurrentSource(generation)) this.broadcast(chunk);
      });

      sourceRes.on('end', () => {
        if (!this.isCurrentSource(generation)) return;
        log.warn(`[MjpegProxy] Source stream ended: ${this.mjpegUrl}`);
        this.sourceFailed();
      });

      sourceRes.on('error', (err) => {
        if (!this.isCurrentSource(generation)) return;
        log.error(`[MjpegProxy] Source stream error: ${err.message}`);
        this.sourceFailed();
      });

      this.sourceConnected();
    });
    this.source = { abort: () => request.destroy() };

    request.on('error', (err: any) => {
      if (!this.isCurrentSource(generation)) return;
      // Principal Insight: Handle HPE_INVALID_CONSTANT (Parse Error)
      // If Node's HTTP parser fails, it's likely a raw stream without HTTP headers.
      if (err.code === 'HPE_INVALID_CONSTANT' || err.message.includes('Parse Error')) {
        log.info(
          '[MjpegProxy] Detected raw (head-less) MJPEG stream from source. Switching to Raw Mode.',
        );
        this.openRawSource();
      } else {
        log.error(`[MjpegProxy] Connection error: ${err.message}`);
        this.sourceFailed();
      }
    });
  }

  /**
   * Raw Source Mode
   * Directly connects via TCP socket to bypass Node's strict HTTP parser.
   * Replaces the failed HTTP attempt as the source, synchronously, so a viewer
   * leaving meanwhile lets this socket go too.
   */
  private openRawSource() {
    const old = this.source;
    this.source = null;
    try {
      old?.abort();
    } catch {
      /* ignore */
    }
    const generation = ++this.sourceGeneration;
    const url = new URL(this.mjpegUrl);

    const socket = net.connect(
      {
        host: url.hostname,
        port: parseInt(url.port || '80'),
      },
      () => {
        if (!this.isCurrentSource(generation)) return;
        log.info(`[MjpegProxy] Raw MJPEG socket connected to ${url.hostname}:${url.port}`);
        // Some MJPEG servers expect a GET request even if they don't send valid HTTP headers back
        socket.write(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\n\r\n`);
        this.sourceConnected();
      },
    );
    this.source = { abort: () => socket.destroy() };

    socket.on('data', (chunk) => {
      if (this.isCurrentSource(generation)) this.broadcast(chunk);
    });

    socket.on('end', () => {
      if (!this.isCurrentSource(generation)) return;
      log.warn('[MjpegProxy] Raw source ended.');
      this.sourceFailed();
    });

    socket.on('error', (err) => {
      if (!this.isCurrentSource(generation)) return;
      log.error(`[MjpegProxy] Raw socket error: ${err.message}`);
      this.sourceFailed();
    });
  }

  private broadcast(chunk: Buffer | string) {
    let dropped = false;
    for (const client of this.clients) {
      if (!client.writable || (client as any).destroyed) {
        this.clients.delete(client);
        dropped = true;
        continue;
      }

      const socket: any = (client as any).socket ?? (client as any).req?.socket;
      const backlog = socket?.writableLength ?? 0;
      if (backlog > UniversalMjpegProxy.MAX_CLIENT_BACKLOG_BYTES) {
        log.warn(
          `[MjpegProxy] Dropping lagging client (backlog=${backlog}B > ${UniversalMjpegProxy.MAX_CLIENT_BACKLOG_BYTES}B) on ${this.mjpegUrl}`,
        );
        try {
          client.end();
        } catch (e) {
          /* ignore */
        }
        this.clients.delete(client);
        dropped = true;
        continue;
      }

      try {
        client.write(chunk);
      } catch (e) {
        this.clients.delete(client);
        dropped = true;
      }
    }
    // A viewer dropped here is a viewer gone: the source goes with the last.
    if (dropped) this.releaseIfUnwatched();
  }

  /**
   * Explicitly stop the proxy and disconnect all clients.
   * Prevents any future reconnection attempts.
   */
  public stop() {
    if (this.state === 'stopped') return;
    this.transition('stopped', 'proxy stopped');

    log.info(
      `[MjpegProxy] Terminating ${this.clients.size} client connections for ${this.mjpegUrl}`,
    );
    for (const client of this.clients) {
      try {
        client.end();
      } catch (e) {
        /* ignore */
      }
    }
    this.clients.clear();
    // Waiting viewers see `stopped` at their next look and get a 503.
  }

  /** The current source failed: retry after a backoff while anyone watches. */
  private sourceFailed() {
    if (this.state === 'stopped') return;

    // If no clients, we should NOT reconnect
    if (this.viewers === 0) {
      this.transition('idle', 'no active clients');
      return;
    }

    // Principal Fix: Enforce maximum retry limit with exponential backoff.
    // Without this, the proxy retries every 500ms FOREVER after a session
    // ends or the server shuts down, flooding logs and wasting CPU.
    // Peek-ahead check: will the next attempt exceed the limit?
    if (this.consecutiveRetries + 1 > UniversalMjpegProxy.MAX_RETRIES) {
      log.warn(
        `[MjpegProxy] Max retries (${UniversalMjpegProxy.MAX_RETRIES}) reached for ${this.mjpegUrl}. Giving up and disconnecting clients.`,
      );
      this.stop();
      return;
    }

    this.consecutiveRetries++;
    this.transition('backoff', 'reconnecting');

    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, 10s (capped)
    const delayMs = Math.min(
      UniversalMjpegProxy.BASE_RETRY_MS * Math.pow(2, this.consecutiveRetries - 1),
      UniversalMjpegProxy.MAX_RETRY_MS,
    );

    log.info(
      `[MjpegProxy] Retry ${this.consecutiveRetries}/${UniversalMjpegProxy.MAX_RETRIES} in ${delayMs}ms...`,
    );
    this.reconnectionTimeout = setTimeout(() => {
      this.reconnectionTimeout = null;
      if (this.state !== 'backoff') return;
      if (this.viewers > 0) this.transition('connecting');
      else this.transition('idle', 'no active clients');
    }, delayMs);
  }
}
