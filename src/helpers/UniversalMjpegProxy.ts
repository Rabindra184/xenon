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
export class UniversalMjpegProxy {
  private mjpegUrl: string;
<<<<<<< HEAD
  private boundary: string = 'BoundaryString';
=======
  private boundary = 'BoundaryString';
>>>>>>> main
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
<<<<<<< HEAD
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private reconnectionTimeout: NodeJS.Timeout | null = null;
  private isStopped: boolean = false;
=======
  private isConnected = false;
  private reconnectionTimeout: NodeJS.Timeout | null = null;
  private isStopped = false;
>>>>>>> main

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

<<<<<<< HEAD
    if (!this.isConnected && !this.isConnecting) {
=======
    if (!this.isConnected) {
>>>>>>> main
      this.startSource();
    }
  }

  private startSource() {
<<<<<<< HEAD
    if (this.isConnected || this.isConnecting || this.isStopped) return;

=======
>>>>>>> main
    const url = new URL(this.mjpegUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
    };

    log.info(`[MjpegProxy] Connecting to source: ${this.mjpegUrl}`);
<<<<<<< HEAD
    this.isConnecting = true;
=======
>>>>>>> main

    this.sourceRequest = http.get(options, (sourceRes) => {
      if (sourceRes.statusCode !== 200) {
        log.error(`[MjpegProxy] Source returned non-200 status: ${sourceRes.statusCode}`);
<<<<<<< HEAD
        this.isConnecting = false;
        this.reconnect();
        return;
      }

      this.isConnected = true;
      this.isConnecting = false;
      // Standard MJPEG
      sourceRes.on('data', (chunk) => {
        this.broadcast(chunk);
      });

      sourceRes.on('end', () => {
        log.warn(`[MjpegProxy] Source stream ended: ${this.mjpegUrl}`);
        this.isConnected = false;
        this.reconnect();
      });

      sourceRes.on('error', (err) => {
        log.error(`[MjpegProxy] Source stream error: ${err.message}`);
        this.isConnected = false;
        this.reconnect();
      });
    });

    this.sourceRequest.on('error', (err: any) => {
      this.isConnecting = false;
      if (this.isStopped) return;
      // Principal Insight: Handle HPE_INVALID_CONSTANT (Parse Error)
      // If Node's HTTP parser fails, it's likely a raw stream without HTTP headers.
      if (err.code === 'HPE_INVALID_CONSTANT' || err.message.includes('Parse Error')) {
        log.info(
          `[MjpegProxy] Detected raw (head-less) MJPEG stream from source. Switching to Raw Mode.`,
        );
        this.startRawSource();
      } else {
        log.error(`[MjpegProxy] Connection request error: ${err.message}`);
        this.isConnected = false;
        this.reconnect();
      }
    });
  }

  /**
   * Raw Source Mode
   * Directly connects via TCP socket to bypass Node's strict HTTP parser.
   */
  private startRawSource() {
    if (this.isConnected || this.isConnecting || this.isStopped) return;

    const url = new URL(this.mjpegUrl);

    this.isConnecting = true;
    const socket = net.connect({
      host: url.hostname,
      port: parseInt(url.port || '80'),
    });

    // Immediately assign sourceRequest so it can be aborted during connection
    this.sourceRequest = { abort: () => socket.destroy() } as any;

    socket.on('connect', () => {
      log.info(`[MjpegProxy] Raw MJPEG socket connected to ${url.hostname}:${url.port}`);
      this.isConnected = true;
      this.isConnecting = false;

      // Some MJPEG servers expect a GET request even if they don't send valid HTTP headers back
      socket.write(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\n\r\n`);
    });

    socket.on('data', (chunk) => {
      this.broadcast(chunk);
    });

    socket.on('end', () => {
      log.warn(`[MjpegProxy] Raw source ended.`);
      this.isConnected = false;
      this.isConnecting = false;
      this.reconnect();
    });

    socket.on('error', (err) => {
      this.isConnecting = false;
      if (this.isStopped) return;
      log.error(`[MjpegProxy] Raw socket error: ${err.message}`);
      this.isConnected = false;
      this.reconnect();
    });
  }

  private broadcast(chunk: Buffer) {
    for (const client of this.clients) {
      try {
        client.write(chunk);
      } catch (e) {
        this.clients.delete(client);
      }
    }
  }

  private stopSource(reason: string = 'intentional') {
    if (!this.sourceRequest && !this.isConnected && !this.isConnecting) return;

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
    this.isConnecting = false;
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

=======
        this.reconnect();
        return;
      }

      this.isConnected = true;
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
        log.error(`[MjpegProxy] Connection request error: ${err.message}`);
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

  private broadcast(chunk: Buffer) {
    for (const client of this.clients) {
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

>>>>>>> main
    if (this.reconnectionTimeout) return; // Already waiting for reconnect

    this.stopSource('reconnecting');

    if (this.clients.size > 0) {
<<<<<<< HEAD
      log.info(`[MjpegProxy] Attempting reconnection in 500ms...`);
=======
      log.info('[MjpegProxy] Attempting reconnection in 500ms...');
>>>>>>> main
      this.reconnectionTimeout = setTimeout(() => {
        this.reconnectionTimeout = null;
        if (this.clients.size > 0 && !this.isStopped) {
          this.startSource();
        }
      }, 500);
    }
  }
}
