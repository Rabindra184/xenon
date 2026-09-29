import { expect } from 'chai';
import http from 'http';
import type { AddressInfo } from 'net';
import { isXenonRunning } from '../../src/helpers';

/**
 * A hub asks whether each node is alive, and a node whether its hub is, with
 * isXenonRunning. With auth on, every /xenon/api route but /health needs a
 * login, and neither side logs in for this probe: a probe of a login-only
 * route called a running server dead, so the hub pruned its node's phones and
 * the node never registered with its hub.
 */
describe('isXenonRunning', () => {
  let server: http.Server;
  let base: string;
  const hits: string[] = [];

  /** Answers the way a Xenon server with auth on does. */
  function authEnabledXenon(req: http.IncomingMessage, res: http.ServerResponse) {
    hits.push(String(req.url));
    if (req.url === '/xenon/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthenticated' }));
  }

  beforeEach(async () => {
    hits.length = 0;
    server = http.createServer(authEnabledXenon);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('calls a server with auth on running', async () => {
    expect(await isXenonRunning(base)).to.equal(true);
    expect(hits).to.deep.equal(['/xenon/api/health']);
  });

  it('calls a server that is not listening not running', async () => {
    // A port that was free a moment ago: bound, read, then closed again.
    const gone = http.createServer();
    await new Promise<void>((resolve) => gone.listen(0, '127.0.0.1', resolve));
    const port = (gone.address() as AddressInfo).port;
    await new Promise<void>((resolve) => gone.close(() => resolve()));

    expect(await isXenonRunning(`http://127.0.0.1:${port}`)).to.equal(false);
  });

  it('calls a server whose health route fails not running', async () => {
    server.removeAllListeners('request');
    server.on('request', (_req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(503);
      res.end();
    });
    expect(await isXenonRunning(base)).to.equal(false);
  });
});
