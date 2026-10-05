import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';

export interface FakeProxy {
  url: string;
  /** What passed through: `GET http://host/path` or `CONNECT host:port`. */
  seen: string[];
  /** The Proxy-Authorization header of each, in the same order (or ''). */
  authorizations: string[];
  close(): Promise<void>;
}

/**
 * An HTTP proxy on 127.0.0.1 that forwards what it is sent and notes it: a
 * request in absolute form (http-proxy-agent, axios) is passed on to its
 * target, a CONNECT (https-proxy-agent, so WebSockets) becomes a tunnel, or
 * is refused with `refuseConnect`. A spec can then tell a call that went
 * through the proxy from one that went straight to the target.
 */
export async function startFakeProxy(
  opts: {
    /** Answer every CONNECT 403, as a stock Squid does for any port but 443. */
    refuseConnect?: boolean;
    /** Never answer a CONNECT, as a proxy that has stopped responding. */
    ignoreConnect?: boolean;
    /**
     * Where a host name is, as the proxy's own DNS would say: a spec names
     * its servers `node.test` and the like, so they aren't loopback names,
     * and the proxy reaches them on 127.0.0.1.
     */
    hosts?: Record<string, string>;
  } = {},
): Promise<FakeProxy> {
  const seen: string[] = [];
  const authorizations: string[] = [];
  const sockets = new Set<net.Socket>();
  const resolve = (host: string) => opts.hosts?.[host] ?? host;
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    authorizations.push(String(req.headers['proxy-authorization'] ?? ''));
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const upstream = http.request(
      {
        ...urlParts(target),
        hostname: resolve(target.hostname),
        method: req.method,
        headers: req.headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.on('connect', (req, client: net.Socket, head: Buffer) => {
    seen.push(`CONNECT ${req.url}`);
    authorizations.push(String(req.headers['proxy-authorization'] ?? ''));
    if (opts.ignoreConnect) {
      sockets.add(client);
      client.on('error', () => client.destroy());
      return;
    }
    if (opts.refuseConnect) {
      client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const [host, port] = String(req.url).split(':');
    const upstream = net.connect(Number(port), resolve(host), () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream).add(client);
    const drop = () => {
      upstream.destroy();
      client.destroy();
    };
    upstream.on('error', drop);
    client.on('error', drop);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    authorizations,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function urlParts(url: URL): http.RequestOptions {
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    path: `${url.pathname}${url.search}`,
  };
}
