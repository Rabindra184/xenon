import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';

export interface FakeProxy {
  url: string;
  /** What passed through: `GET http://host/path` or `CONNECT host:port`. */
  seen: string[];
  close(): Promise<void>;
}

/**
 * An HTTP proxy on 127.0.0.1 that forwards what it is sent and notes it: a
 * request in absolute form (http-proxy-agent, axios) is passed on to its
 * target, a CONNECT (https-proxy-agent, so WebSockets) becomes a tunnel. A
 * spec can then tell a call that went through the proxy from one that went
 * straight to the target.
 */
export async function startFakeProxy(): Promise<FakeProxy> {
  const seen: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const upstream = http.request(
      target,
      { method: req.method, headers: req.headers },
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
    const [host, port] = String(req.url).split(':');
    const upstream = net.connect(Number(port), host, () => {
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
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
