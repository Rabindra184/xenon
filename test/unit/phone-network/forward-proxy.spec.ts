import { expect } from 'chai';
import http from 'http';
import net from 'net';
import { ForwardProxy, sharedForwardProxy } from '../../../src/services/network/ForwardProxy';
import { loopbackServers } from '../../helpers/loopbackServer';

/**
 * ENH-20 part 2: the proxy a shaped phone's relay forwards to when the
 * session doesn't capture its traffic. Tunnels HTTPS (CONNECT) and forwards
 * plain HTTP, on loopback only.
 */
describe('ForwardProxy', function () {
  this.timeout(15_000);
  const loopback = loopbackServers();
  let proxy: ForwardProxy | undefined;

  afterEach(async () => {
    await proxy?.stop();
    proxy = undefined;
    await loopback.closeAll();
  });

  /** A TCP server that echoes what it is sent. */
  async function echoServer(): Promise<number> {
    const server = await loopback.serve(net.createServer((s) => s.pipe(s)) as any);
    return (server.address() as net.AddressInfo).port;
  }

  /** Opens a CONNECT tunnel; resolves with the proxy's status line and the socket. */
  function connect(
    proxyPort: number,
    target: string,
  ): Promise<{ status: string; socket: net.Socket }> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(proxyPort, '127.0.0.1', () => {
        socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      });
      let head = '';
      const onData = (data: Buffer) => {
        head += data.toString('latin1');
        const end = head.indexOf('\r\n\r\n');
        if (end === -1) return;
        socket.off('data', onData);
        resolve({ status: head.split('\r\n')[0], socket });
      };
      socket.on('data', onData);
      socket.on('error', reject);
    });
  }

  it('tunnels a CONNECT to its target and relays both ways', async () => {
    const echo = await echoServer();
    proxy = new ForwardProxy();
    const port = await proxy.start();

    const { status, socket } = await connect(port, `127.0.0.1:${echo}`);
    expect(status).to.match(/^HTTP\/1\.1 200 Connection Established/);
    const back = new Promise<string>((resolve) =>
      socket.once('data', (d) => resolve(d.toString())),
    );
    socket.write('hello through the tunnel');
    expect(await back).to.equal('hello through the tunnel');
    socket.destroy();
  });

  it('forwards a plain HTTP request in absolute form', async () => {
    const server = await loopback.serve(
      http.createServer((req, res) => {
        res.setHeader('x-path', req.url ?? '');
        res.end('plain answer');
      }) as any,
    );
    const target = (server.address() as net.AddressInfo).port;
    proxy = new ForwardProxy();
    const port = await proxy.start();

    const answer = await new Promise<{ status?: number; path?: string; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'GET',
            path: `http://127.0.0.1:${target}/x?y=1`,
            headers: { host: `127.0.0.1:${target}` },
          },
          (res) => {
            let body = '';
            res.on('data', (d) => (body += d));
            res.on('end', () =>
              resolve({ status: res.statusCode, path: res.headers['x-path'] as string, body }),
            );
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    expect(answer).to.deep.equal({ status: 200, path: '/x?y=1', body: 'plain answer' });
  });

  it('answers 502 to a CONNECT it cannot complete', async () => {
    proxy = new ForwardProxy();
    const port = await proxy.start();
    const { status, socket } = await connect(port, '127.0.0.1:1');
    expect(status).to.match(/^HTTP\/1\.1 502/);
    socket.destroy();
  });

  it('closes the tunnel when either side closes', async () => {
    let serverSide: net.Socket | undefined;
    const server = await loopback.serve(net.createServer((s) => (serverSide = s)) as any);
    const target = (server.address() as net.AddressInfo).port;
    proxy = new ForwardProxy();
    const port = await proxy.start();

    const { socket } = await connect(port, `127.0.0.1:${target}`);
    for (let i = 0; i < 50 && !serverSide; i++) await new Promise((r) => setTimeout(r, 10));
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    serverSide!.destroy();
    await closed;
  });

  it('listens on 127.0.0.1 only', async () => {
    proxy = new ForwardProxy();
    await proxy.start();
    expect(proxy.address()).to.equal('127.0.0.1');
  });

  it('shares one instance and stops it with its last holder', async () => {
    const first = await sharedForwardProxy.acquire();
    const second = await sharedForwardProxy.acquire();
    expect(second).to.equal(first);

    await sharedForwardProxy.release();
    const stillUp = await new Promise<boolean>((resolve) => {
      const s = net.connect(first, '127.0.0.1', () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
    expect(stillUp).to.equal(true);

    await sharedForwardProxy.release();
    const refused = await new Promise<boolean>((resolve) => {
      const s = net.connect(first, '127.0.0.1', () => {
        s.destroy();
        resolve(false);
      });
      s.on('error', () => resolve(true));
    });
    expect(refused).to.equal(true);
  });
});
