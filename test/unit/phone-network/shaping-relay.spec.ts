import { expect } from 'chai';
import net from 'net';
import { LinkShaper, ShapeLimits } from '../../../src/services/network/LinkShaper';
import { ShapingRelay } from '../../../src/services/network/ShapingRelay';
import { ForwardProxy } from '../../../src/services/network/ForwardProxy';

/**
 * ENH-20 part 2: the relay a real phone's proxy points at. It shapes every
 * connection the phone opens through the phone's LinkShaper, and forwards it
 * to its target (the capture proxy, or the forward proxy) unread.
 */
describe('ShapingRelay', function () {
  this.timeout(30_000);

  const THREE_G: ShapeLimits = { downKbps: 2000, upKbps: 1000, latencyMs: 100 };
  const closers: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
  });

  async function listen(server: net.Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return (server.address() as net.AddressInfo).port;
  }

  /** A raw TCP echo target; keeps its sockets so a test can watch them. */
  async function echoTarget() {
    const sockets: net.Socket[] = [];
    const server = net.createServer((s) => {
      sockets.push(s);
      s.on('error', () => undefined);
      s.pipe(s);
    });
    closers.push(() => sockets.forEach((s) => s.destroy()));
    return { port: await listen(server), sockets };
  }

  async function freePort(): Promise<number> {
    const probe = net.createServer();
    const port = await new Promise<number>((resolve) =>
      probe.listen(0, '127.0.0.1', () => resolve((probe.address() as net.AddressInfo).port)),
    );
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  async function relayTo(
    target: () => { host: string; port: number },
    shaper = new LinkShaper(),
    bindHost: '127.0.0.1' | '0.0.0.0' = '127.0.0.1',
  ) {
    const relay = new ShapingRelay({ port: await freePort(), bindHost, shaper, target });
    await relay.start();
    closers.push(() => relay.stop());
    return relay;
  }

  const open = (port: number) =>
    new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });

  /** Writes `bytes` and resolves when as many have come back. */
  function roundTrip(socket: net.Socket, bytes: number): Promise<number> {
    const started = Date.now();
    return new Promise((resolve) => {
      let got = 0;
      socket.on('data', (d: Buffer) => {
        got += d.length;
        if (got >= bytes) resolve(Date.now() - started);
      });
      socket.write(Buffer.alloc(bytes, 1));
    });
  }

  it('relays a CONNECT through a ForwardProxy target, shaped', async () => {
    const echo = await echoTarget();
    const forward = new ForwardProxy();
    const forwardPort = await forward.start();
    closers.push(() => forward.stop());
    const relay = await relayTo(
      () => ({ host: '127.0.0.1', port: forwardPort }),
      new LinkShaper(THREE_G),
    );

    const phone = await open(relay.port());
    const head = new Promise<string>((resolve) => phone.once('data', (d) => resolve(d.toString())));
    phone.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\n\r\n`);
    expect(await head).to.match(/^HTTP\/1\.1 200/);

    const size = 64 * 1024;
    const ms = await roundTrip(phone, size);
    // The echo streams back as it arrives, so the slower direction (up, at
    // 1000 kbps) sets the pace, plus half the latency each way.
    const least = (size / (1000 * 125)) * 1000 * 0.9 + 80;
    expect(ms).to.be.at.least(least);
    phone.destroy();
  });

  it('relays to a stand-in capture proxy unchanged', async () => {
    const echo = await echoTarget();
    const relay = await relayTo(() => ({ host: '127.0.0.1', port: echo.port }));
    const phone = await open(relay.port());
    const sent = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
    const got: Buffer[] = [];
    await new Promise<void>((resolve) => {
      phone.on('data', (d: Buffer) => {
        got.push(d);
        if (Buffer.concat(got).length >= sent.length) resolve();
      });
      phone.write(sent);
    });
    expect(Buffer.concat(got).equals(sent)).to.equal(true);
    phone.destroy();
  });

  it('closes the upstream when the phone closes mid-transfer, and frees its share', async () => {
    const echo = await echoTarget();
    const shaper = new LinkShaper({ ...THREE_G, latencyMs: 0 });
    const relay = await relayTo(() => ({ host: '127.0.0.1', port: echo.port }), shaper);

    const first = await open(relay.port());
    first.write(Buffer.alloc(256 * 1024)); // ~2 s at 1000 kbps up
    for (let i = 0; i < 50 && echo.sockets.length === 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    const upstreamClosed = new Promise<void>((resolve) =>
      echo.sockets[0].once('close', () => resolve()),
    );
    first.destroy();
    const closedAt = Date.now();
    await upstreamClosed;
    // A FIN alone could be a half-close; the closed phone shows when a write
    // back to it fails. Well before the ~2 s its queued upload would take.
    expect(Date.now() - closedAt).to.be.below(300);

    // The closed connection's queued bytes no longer take the phone's bandwidth.
    const second = await open(relay.port());
    const ms = await roundTrip(second, 16 * 1024); // ~130 ms up + ~65 ms down
    expect(ms).to.be.below(600);
    second.destroy();
  });

  it('closes the phone side when the target refuses, and keeps serving', async () => {
    const echo = await echoTarget();
    let target = { host: '127.0.0.1', port: 1 };
    const relay = await relayTo(() => target);

    const refused = await open(relay.port());
    await new Promise<void>((resolve) => refused.once('close', () => resolve()));

    target = { host: '127.0.0.1', port: echo.port };
    const ok = await open(relay.port());
    expect(await roundTrip(ok, 10)).to.be.below(500);
    ok.destroy();
  });

  it('carries the answer back after the phone half-closes its side', async () => {
    // A client that sends its request and then shuts down its sending side
    // (toybox nc on a phone, some HTTP/1.0 clients) still gets the answer.
    const server = net.createServer({ allowHalfOpen: true }, (s) => {
      let got = '';
      s.on('data', (d: Buffer) => (got += d));
      s.on('end', () => s.end(`answer to ${got}`));
    });
    const port = await listen(server);
    const relay = await relayTo(() => ({ host: '127.0.0.1', port }));

    const phone = net.connect({ port: relay.port(), host: '127.0.0.1', allowHalfOpen: true });
    const answer = await new Promise<string>((resolve, reject) => {
      let got = '';
      phone.on('data', (d: Buffer) => (got += d));
      phone.on('end', () => resolve(got));
      phone.on('error', reject);
      phone.on('connect', () => phone.end('the request'));
    });
    expect(answer).to.equal('answer to the request');
  });

  it('half-closes through a ForwardProxy CONNECT tunnel too', async () => {
    const server = net.createServer({ allowHalfOpen: true }, (s) => {
      let got = '';
      s.on('data', (d: Buffer) => (got += d));
      s.on('end', () => s.end(`answer to ${got}`));
    });
    const target = await listen(server);
    const forward = new ForwardProxy();
    const forwardPort = await forward.start();
    closers.push(() => forward.stop());
    const relay = await relayTo(() => ({ host: '127.0.0.1', port: forwardPort }));

    const phone = net.connect({ port: relay.port(), host: '127.0.0.1', allowHalfOpen: true });
    const answer = await new Promise<string>((resolve, reject) => {
      let got = '';
      phone.on('data', (d: Buffer) => (got += d));
      phone.on('end', () => resolve(got));
      phone.on('error', reject);
      phone.on('connect', () => {
        phone.write(`CONNECT 127.0.0.1:${target} HTTP/1.1\r\n\r\n`);
        phone.once('data', () => phone.end('the request'));
      });
    });
    expect(answer).to.match(/^HTTP\/1\.1 200[^]*answer to the request$/);
  });

  it('forwards a plain HTTP request a phone sends and then half-closes', async () => {
    const http = await import('http');
    const origin = http.createServer((_req, res) => res.end('plain answer'));
    const originPort = await listen(origin as unknown as net.Server);
    const forward = new ForwardProxy();
    const forwardPort = await forward.start();
    closers.push(() => forward.stop());
    const relay = await relayTo(() => ({ host: '127.0.0.1', port: forwardPort }));

    const phone = net.connect({ port: relay.port(), host: '127.0.0.1', allowHalfOpen: true });
    const answer = await new Promise<string>((resolve, reject) => {
      let got = '';
      phone.on('data', (d: Buffer) => (got += d));
      phone.on('end', () => resolve(got));
      phone.on('error', reject);
      phone.on('connect', () =>
        phone.end(
          `GET http://127.0.0.1:${originPort}/x HTTP/1.0\r\nHost: 127.0.0.1:${originPort}\r\n\r\n`,
        ),
      );
    });
    expect(answer).to.match(/^HTTP\/1\.[01] 200[^]*plain answer$/);
  });

  it('stop() closes every open connection and the listener', async () => {
    const echo = await echoTarget();
    const relay = new ShapingRelay({
      port: await freePort(),
      bindHost: '127.0.0.1',
      shaper: new LinkShaper(),
      target: () => ({ host: '127.0.0.1', port: echo.port }),
    });
    await relay.start();
    const phone = await open(relay.port());
    const closed = new Promise<void>((resolve) => phone.once('close', () => resolve()));
    await relay.stop();
    await closed;
    const refused = await open(relay.port()).then(
      (s) => (s.destroy(), false),
      () => true,
    );
    expect(refused).to.equal(true);
  });

  it('binds the host it is given', async () => {
    const echo = await echoTarget();
    const relay = await relayTo(
      () => ({ host: '127.0.0.1', port: echo.port }),
      new LinkShaper(),
      '0.0.0.0',
    );
    expect(relay.address()).to.equal('0.0.0.0');
  });
});
