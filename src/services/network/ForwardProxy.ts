import http from 'http';
import net from 'net';
import log from '../../logger';

/**
 * The proxy a shaped phone's relay forwards to when the session doesn't
 * capture its traffic (ENH-20 part 2): `CONNECT host:port` tunnels (HTTPS,
 * WebSockets over TLS) and plain-HTTP requests in absolute form. No TLS, no
 * caching, no rewriting. It listens on 127.0.0.1 only: the phone reaches it
 * through its relay, never directly.
 *
 * It is the phone's way out, so it connects direct: Xenon's outbound-proxy
 * rule (outboundProxyFor) is for Xenon's own calls.
 */

/** Hop-by-hop headers: about one connection, never forwarded. */
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
]);

function endToEnd(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/** `host:port` of a CONNECT, or undefined when it isn't one. */
function connectTarget(url: string | undefined): { host: string; port: number } | undefined {
  const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(url ?? '');
  if (!m) return undefined;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1], port } : undefined;
}

export class ForwardProxy {
  private server: http.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  private readonly logger = log.scope('ForwardProxy');

  /** Starts listening on 127.0.0.1; resolves with the port. */
  async start(): Promise<number> {
    const server = http.createServer((req, res) => this.forward(req, res));
    server.on('connect', (req, client: net.Socket, head: Buffer) => this.tunnel(req, client, head));
    server.on('connection', (socket: net.Socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    return (server.address() as net.AddressInfo).port;
  }

  /** The address it listens on. */
  address(): string | undefined {
    return (this.server?.address() as net.AddressInfo | null)?.address;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private tunnel(req: http.IncomingMessage, client: net.Socket, head: Buffer): void {
    this.sockets.add(client);
    client.once('close', () => this.sockets.delete(client));
    const target = connectTarget(req.url);
    if (!target) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const upstream = net.connect(target.port, target.host);
    this.sockets.add(upstream);
    upstream.once('close', () => this.sockets.delete(upstream));
    let open = false;
    upstream.once('connect', () => {
      open = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', (err) => {
      if (!open) {
        client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        this.logger.debug(`CONNECT ${req.url} failed: ${err.message}`);
      } else {
        client.destroy();
      }
    });
    client.on('error', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    client.once('close', () => upstream.destroy());
  }

  private forward(req: http.IncomingMessage, res: http.ServerResponse): void {
    let url: URL;
    try {
      url = new URL(req.url ?? '');
      if (url.protocol !== 'http:') throw new Error('not http');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const upstream = http.request(
      {
        host: url.hostname,
        port: url.port || 80,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: endToEnd(req.headers),
        agent: false,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, endToEnd(answer.headers));
        answer.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    req.pipe(upstream);
  }
}

/**
 * One forward proxy for the whole server, shared by every shaped phone's
 * relay: started by the first holder, stopped when the last one lets go.
 */
let shared: { proxy: ForwardProxy; port: Promise<number>; holders: number } | undefined;

export const sharedForwardProxy = {
  async acquire(): Promise<number> {
    if (!shared) {
      const proxy = new ForwardProxy();
      shared = { proxy, port: proxy.start(), holders: 0 };
    }
    shared.holders += 1;
    try {
      return await shared.port;
    } catch (err) {
      shared = undefined;
      throw err;
    }
  },

  async release(): Promise<void> {
    if (!shared) return;
    shared.holders -= 1;
    if (shared.holders > 0) return;
    const { proxy } = shared;
    shared = undefined;
    await proxy.stop();
  },
};
