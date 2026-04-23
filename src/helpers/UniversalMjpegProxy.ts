import { Request, Response } from 'express';
import http from 'http';
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

  private clients: Set<Response> = new Set();
  private sourceRequest: http.ClientRequest | null = null;
  private isConnected = false;
  private reconnectionTimeout: NodeJS.Timeout | null = null;
  private isStopped = false;

  /**
   * Principal Resilience: Retry limits with exponential backoff.
   * Without these, the proxy retries every 500ms FOREVER, flooding logs
   * and wasting CPU after a session ends or the server shuts down.
   */
  private consecutiveRetries = 0;
  private static readonly MAX_RETRIES = 10;
  private static readonly BASE_RETRY_MS = 500;
  private static readonly MAX_RETRY_MS = 10000;

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

  public proxyRequest(req: Request, res: Response) {
    res.writeHead(200, this.globalResponseHeaders);
    this.clients.add(res);

    log.debug(
      `[MjpegProxy] New client joined stream: ${this.mjpegUrl}. Total clients: ${this.clients.size}`,
    );

    req.on('close', () => {
      this.clients.delete(res);
      log.debug(`[MjpegProxy] Client left stream. Remaining: ${this.clients.size}`);
      if (this.clients.size === 0) {
        this.stopSource();
      }
    });

    if (!this.isConnected) {
      this.startSource();
    }
  }

  private startSource() {
    const url = new URL(this.mjpegUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
    };

    log.info(`[MjpegProxy] Connecting to source: ${this.mjpegUrl}`);

    this.sourceRequest = http.get(options, (sourceRes) => {
      if (sourceRes.statusCode !== 200) {
        log.error(`[MjpegProxy] Source returned non-200 status: ${sourceRes.statusCode}`);
        this.reconnect();
        return;
      }

      this.isConnected = true;
      this.consecutiveRetries = 0; // Reset on successful connection

      // Standard MJPEG
      sourceRes.on('data', (chunk) => {
        this.broadcast(chunk);
      });

      sourceRes.on('end', () => {
        log.warn(`[MjpegProxy] Source stream ended: ${this.mjpegUrl}`);
        this.reconnect();
      });

      sourceRes.on('error', (err) => {
        log.error(`[MjpegProxy] Source stream error: ${err.message}`);
        this.reconnect();
      });
    });

    this.sourceRequest.on('error', (err: any) => {
      if (this.isStopped) return;
      // Principal Insight: Handle HPE_INVALID_CONSTANT (Parse Error)
      // If Node's HTTP parser fails, it's likely a raw stream without HTTP headers.
      if (err.code === 'HPE_INVALID_CONSTANT' || err.message.includes('Parse Error')) {
        log.info(
          '[MjpegProxy] Detected raw (head-less) MJPEG stream from source. Switching to Raw Mode.',
        );
        this.startRawSource();
      } else {
        log.error(`[MjpegProxy] Connection error: ${err.message}`);
        this.reconnect();
      }
    });
  }

  /**
   * Raw Source Mode
   * Directly connects via TCP socket to bypass Node's strict HTTP parser.
   */
  private async startRawSource() {
    const net = await import('net');
    const url = new URL(this.mjpegUrl);

    const socket = net.connect(
      {
        host: url.hostname,
        port: parseInt(url.port || '80'),
      },
      () => {
        log.info(`[MjpegProxy] Raw MJPEG socket connected to ${url.hostname}:${url.port}`);
        this.isConnected = true;
        this.consecutiveRetries = 0; // Reset on successful connection

        // Some MJPEG servers expect a GET request even if they don't send valid HTTP headers back
        socket.write(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\n\r\n`);
      },
    );

    socket.on('data', (chunk) => {
      this.broadcast(chunk);
    });

    socket.on('end', () => {
      log.warn('[MjpegProxy] Raw source ended.');
      this.reconnect();
    });

    socket.on('error', (err) => {
      if (this.isStopped) return;
      log.error(`[MjpegProxy] Raw socket error: ${err.message}`);
      this.reconnect();
    });

    this.sourceRequest = { abort: () => socket.destroy() } as any;
  }

  private broadcast(chunk: Buffer | string) {
    for (const client of this.clients) {
      if (!client.writable || (client as any).destroyed) {
        this.clients.delete(client);
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
        continue;
      }

      try {
        client.write(chunk);
      } catch (e) {
        this.clients.delete(client);
      }
    }
  }

  private stopSource(reason = 'intentional') {
    if (!this.sourceRequest && !this.isConnected) return;

    log.info(`[MjpegProxy] Stopping source (${reason}): ${this.mjpegUrl}`);
    if (this.sourceRequest) {
      try {
        this.sourceRequest.abort();
      } catch (e) {
        /* ignore */
      }
      this.sourceRequest = null;
    }
    this.isConnected = false;
  }

  /**
   * Explicitly stop the proxy and disconnect all clients.
   * Prevents any future reconnection attempts.
   */
  public stop() {
    if (this.isStopped) return;
    this.isStopped = true;
    if (this.reconnectionTimeout) {
      clearTimeout(this.reconnectionTimeout);
      this.reconnectionTimeout = null;
    }

    this.stopSource('proxy stopped');

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
  }

  private reconnect() {
    if (this.isStopped) return;

    // If no clients, we should NOT reconnect
    if (this.clients.size === 0) {
      this.stopSource('no active clients');
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

    // Guard: if a reconnection is already scheduled, don't schedule another
    // and don't inflate the retry counter.
    if (this.reconnectionTimeout) return;

    // Only increment when a real reconnection will be scheduled.
    this.consecutiveRetries++;

    this.stopSource('reconnecting');

    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, 10s (capped)
    const delayMs = Math.min(
      UniversalMjpegProxy.BASE_RETRY_MS * Math.pow(2, this.consecutiveRetries - 1),
      UniversalMjpegProxy.MAX_RETRY_MS,
    );

    if (this.clients.size > 0) {
      log.info(
        `[MjpegProxy] Retry ${this.consecutiveRetries}/${UniversalMjpegProxy.MAX_RETRIES} in ${delayMs}ms...`,
      );
      this.reconnectionTimeout = setTimeout(() => {
        this.reconnectionTimeout = null;
        if (this.clients.size > 0 && !this.isStopped) {
          this.startSource();
        }
      }, delayMs);
    }
  }
}
