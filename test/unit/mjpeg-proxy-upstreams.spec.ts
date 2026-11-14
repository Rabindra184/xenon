import http from 'http';
import net from 'net';
import express from 'express';
import { expect } from 'chai';
import { UniversalMjpegProxy } from '../../src/helpers/UniversalMjpegProxy';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * One upstream per proxy, and none once nobody watches.
 *
 * Through 2.36 every viewer that arrived while the proxy wasn't connected
 * started another upstream (during the first viewer's connect wait, or during
 * a reconnect's backoff, whose timer then started one more), and only the
 * last was kept, so the others could never be stopped. A viewer that hung up
 * during the connect wait was still added once the source answered, and
 * nothing stopped the source when it was pruned: an upstream ran with nobody
 * watching. On Android that upstream is a viewer of the phone's MJPEG
 * server, so its screencap ran at full rate and its preview hold was never
 * released.
 */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 3000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end && !check(); ) await pause(20);
}

/** An upstream MJPEG source that counts the connections and requests it gets. */
interface Upstream {
  url: string;
  requests: number;
  open: number;
  /** Answers the upstream finished (endRequest). */
  ended?: number;
  close(): Promise<void>;
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)),
  );
}

async function httpUpstream(opts: {
  answerAfterMs?: number;
  /** The nth request (1-based) whose answer ends after 400 ms; the rest stay open. */
  endRequest?: number;
}): Promise<Upstream> {
  const sockets = new Set<net.Socket>();
  const up: any = { requests: 0, open: 0, ended: 0 };
  const server = http.createServer((_req, res) => {
    const n = ++up.requests;
    setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
      res.write('--frame\r\n\r\nx\r\n');
      const timer = setInterval(() => !res.destroyed && res.write('--frame\r\n\r\nx\r\n'), 30);
      res.on('close', () => clearInterval(timer));
      if (n === opts.endRequest) {
        setTimeout(() => {
          clearInterval(timer);
          res.end(() => (up.ended += 1));
        }, 400);
      }
    }, opts.answerAfterMs ?? 0);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    up.open += 1;
    socket.on('close', () => {
      sockets.delete(socket);
      up.open -= 1;
    });
  });
  const port = await listen(server);
  up.url = `http://127.0.0.1:${port}`;
  up.close = () =>
    new Promise<void>((resolve) => {
      sockets.forEach((s) => s.destroy());
      server.close(() => resolve());
    });
  return up;
}

/**
 * WebDriverAgent's head-less variant: the first connection (the proxy's
 * HTTP attempt) gets bytes no HTTP parser takes, and the proxy switches to
 * a raw socket, which counts as `requests` here once it sends its GET.
 */
async function rawUpstream(): Promise<Upstream> {
  const sockets = new Set<net.Socket>();
  const up: any = { requests: 0, open: 0 };
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    up.open += 1;
    socket.on('close', () => {
      sockets.delete(socket);
      up.open -= 1;
    });
    socket.on('error', () => undefined);
    const first = connections === 1;
    socket.once('data', () => {
      if (first) {
        socket.end('--BoundaryString\r\nnot http\r\n\r\n');
        return;
      }
      up.requests += 1;
      const timer = setInterval(
        () => !socket.destroyed && socket.write('--BoundaryString\r\n'),
        30,
      );
      socket.on('close', () => clearInterval(timer));
    });
  });
  const port = await listen(server);
  up.url = `http://127.0.0.1:${port}`;
  up.close = () =>
    new Promise<void>((resolve) => {
      sockets.forEach((s) => s.destroy());
      server.close(() => resolve());
    });
  return up;
}

describe('UniversalMjpegProxy keeps one upstream, and none when nobody watches', () => {
  const loopback = loopbackServers();
  const upstreams: Upstream[] = [];
  const proxies: UniversalMjpegProxy[] = [];
  const viewers: http.ClientRequest[] = [];
  let front: string;

  async function serve(proxy: UniversalMjpegProxy): Promise<void> {
    proxies.push(proxy);
    const app = express();
    app.get('/stream', (req, res) => void proxy.proxyRequest(req, res));
    const server = await loopback.serve(app);
    front = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/stream`;
  }

  /** A browser viewer; `status` is filled in when the proxy answers. */
  function watch(): { req: http.ClientRequest; status?: number } {
    const viewer: { req: http.ClientRequest; status?: number } = {} as any;
    viewer.req = http.get(front, { agent: false }, (res) => {
      viewer.status = res.statusCode;
      res.resume();
    });
    viewer.req.on('error', () => undefined);
    viewers.push(viewer.req);
    return viewer;
  }

  afterEach(async () => {
    viewers.splice(0).forEach((v) => v.destroy());
    proxies.splice(0).forEach((p) => p.stop());
    await loopback.closeAll();
    await Promise.all(upstreams.splice(0).map((u) => u.close()));
  });

  it('a second viewer during the first one’s connect wait shares its upstream', async () => {
    const up = await httpUpstream({ answerAfterMs: 300 });
    upstreams.push(up);
    await serve(new UniversalMjpegProxy(up.url));

    const a = watch();
    await pause(80);
    const b = watch();
    await until(() => a.status === 200 && b.status === 200);

    expect([a.status, b.status]).to.deep.equal([200, 200]);
    expect(up.requests, 'one upstream request').to.equal(1);
  });

  it('a viewer who hangs up during the connect wait leaves no upstream running', async () => {
    const up = await httpUpstream({ answerAfterMs: 300 });
    upstreams.push(up);
    const proxy = new UniversalMjpegProxy(up.url);
    await serve(proxy);

    const a = watch();
    await until(() => up.requests === 1);
    a.req.destroy();

    await pause(600); // past the moment the upstream answers
    await until(() => up.open === 0);
    expect(up.open, 'no upstream connection is left').to.equal(0);
    expect(proxy.stopped, 'the proxy stays usable').to.equal(false);
  });

  it('the last viewer leaving stops the upstream', async () => {
    const up = await httpUpstream({});
    upstreams.push(up);
    await serve(new UniversalMjpegProxy(up.url));

    const a = watch();
    const b = watch();
    await until(() => a.status === 200 && b.status === 200);
    a.req.destroy();
    await pause(150);
    expect(up.open, 'one viewer still watches').to.equal(1);
    b.req.destroy();
    await until(() => up.open === 0);
    expect(up.open).to.equal(0);
  });

  it('a viewer arriving during a reconnect’s backoff opens no upstream of its own', async () => {
    const up = await httpUpstream({ endRequest: 1 });
    upstreams.push(up);
    await serve(new UniversalMjpegProxy(up.url));

    const a = watch();
    await until(() => a.status === 200);
    // The first answer ends; the proxy lets that connection go and waits
    // 500 ms to retry.
    await until(() => up.ended === 1);
    await pause(100);
    expect(up.requests).to.equal(1);
    const b = watch();
    await until(() => b.status === 200, 3000);
    await pause(300);

    expect(b.status).to.equal(200);
    expect(up.requests, 'the first request and one retry').to.equal(2);
    expect(up.open, 'one upstream connection').to.equal(1);
  });

  it('a head-less source is let go when its only viewer hangs up while it connects', async () => {
    const up = await rawUpstream();
    upstreams.push(up);
    const proxy = new UniversalMjpegProxy(up.url);
    await serve(proxy);

    const a = watch();
    await until(() => up.requests === 1);
    a.req.destroy();

    await until(() => up.open === 0);
    expect(up.open, 'the raw socket is closed').to.equal(0);
  });

  it('a head-less source serves its viewer, and stop() closes it', async () => {
    const up = await rawUpstream();
    upstreams.push(up);
    const proxy = new UniversalMjpegProxy(up.url);
    await serve(proxy);

    const a = watch();
    await until(() => a.status === 200);
    expect(a.status).to.equal(200);
    proxy.stop();
    await until(() => up.open === 0);
    expect(up.open).to.equal(0);
  });
});
