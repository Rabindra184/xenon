import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import http from 'http';
import https from 'https';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { Server as IoServer } from 'socket.io';
import { WebSocket, WebSocketServer } from 'ws';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { outboundProxyFor } from '../../src/helpers/outboundProxy';
import { sendToNode, readAnswer } from '../../src/gateway/forwardToNode';
import { HubSessionTokenIssuer, HubSessionTokenVerifier } from '../../src/gateway/hubSessionToken';
import { nodeWebDriverUrl } from '../../src/gateway/nodeWebDriverUrl';
import { openNodeSocket } from '../../src/app/ws/nodeSocketRelay';
import { RemoteSession } from '../../src/sessions/RemoteSession';
import { LocalSession } from '../../src/sessions/LocalSession';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SocketClient } from '../../src/services/SocketClient';
import { InternalHttpClient } from '../../src/InternalHttpClient';
import { isXenonRunning } from '../../src/helpers';
import { md, pki } from 'node-forge';
import { saveRegistrations } from '../helpers/container-registration';
import { FakeProxy, startFakeProxy } from '../helpers/fake-http-proxy';

const PROXY_ENV = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
];

/**
 * The `proxy` plugin option reached one call: the create a hub sends to a node
 * or a cloud provider. The session's commands, its screenshots and heartbeats,
 * device control, the sockets, and a node's calls to its hub all took the
 * environment's proxy instead, or none: a lab that set only the option had
 * its sessions created through the proxy and then driven straight at the node.
 *
 * Every call one Xenon server makes to another, or to a cloud provider, now
 * takes it. NO_PROXY still names the hosts that go direct, and so does any
 * loopback host, which a proxy elsewhere can't reach.
 */
describe('the proxy plugin option', function () {
  this.timeout(30_000);

  describe('the rule', () => {
    const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;
    const option = { host: 'squid.lab', port: 3128 };

    it("is taken over the environment's proxy, for http and https alike", () => {
      const vars = env({ HTTP_PROXY: 'http://env:1', HTTPS_PROXY: 'http://env:2' });
      expect(outboundProxyFor('http://node.lab:4723/x', { env: vars, option })).to.equal(
        'http://squid.lab:3128',
      );
      expect(outboundProxyFor('https://cloud.example/wd/hub', { env: vars, option })).to.equal(
        'http://squid.lab:3128',
      );
      expect(outboundProxyFor('ws://node.lab:4723/x', { env: vars, option })).to.equal(
        'http://squid.lab:3128',
      );
    });

    it('is written as a URL: its protocol, its credentials escaped, or the string it is', () => {
      expect(
        outboundProxyFor('http://node.lab/x', {
          env: env({}),
          option: {
            protocol: 'https',
            host: 'squid.lab',
            port: 3129,
            auth: { username: 'lab@x', password: 'p:ss' },
          },
        }),
      ).to.equal('https://lab%40x:p%3Ass@squid.lab:3129');
      expect(
        outboundProxyFor('http://node.lab/x', { env: env({}), option: 'http://squid.lab:8080' }),
      ).to.equal('http://squid.lab:8080');
      expect(
        outboundProxyFor('http://node.lab/x', { env: env({}), option: { host: 'squid.lab' } }),
      ).to.equal('http://squid.lab');
    });

    it('leaves a host NO_PROXY names direct', () => {
      expect(
        outboundProxyFor('http://node.lab:4723/x', {
          env: env({ NO_PROXY: '.lab' }),
          option,
        }),
      ).to.equal(undefined);
    });

    it('leaves loopback hosts direct; the environment still decides for them', () => {
      for (const url of [
        'http://localhost:4724/x',
        'http://127.0.0.1:4724/x',
        'http://127.1.2.3/x',
        'http://[::1]:4724/x',
      ]) {
        expect(outboundProxyFor(url, { env: env({}), option }), url).to.equal(undefined);
      }
      expect(
        outboundProxyFor('http://127.0.0.1:4724/x', {
          env: env({ HTTP_PROXY: 'http://env:1' }),
          option,
        }),
      ).to.equal('http://env:1');
    });

    it('is ignored, with a warning, when it names no host', () => {
      const warn = sinon.stub();
      expect(
        outboundProxyFor('http://node.lab/x', {
          env: env({ HTTP_PROXY: 'http://env:1' }),
          option: { port: 3128 },
          warn,
        }),
      ).to.equal('http://env:1');
      expect(warn.calledOnce).to.equal(true);
      expect(warn.firstCall.args[0]).to.include('proxy');
    });
  });

  describe('every call to another server goes through it', () => {
    let proxy: FakeProxy;
    let context: PluginContext;
    let savedContext: Partial<PluginContext>;
    let savedEnv: Record<string, string | undefined>;
    let restoreRegs: () => void;
    const servers: http.Server[] = [];
    const sockets: WebSocketServer[] = [];
    const ios: IoServer[] = [];

    beforeEach(async () => {
      savedEnv = Object.fromEntries(PROXY_ENV.map((k) => [k, process.env[k]]));
      for (const k of PROXY_ENV) delete process.env[k];
      proxy = await startFakeProxy({
        hosts: { 'node.test': '127.0.0.1', 'hub.test': '127.0.0.1' },
      });
      context = Container.get(PluginContext);
      savedContext = { ...context };
      const [, proxyPort] = proxy.url.replace('http://', '').split(':');
      context.setContext(
        {
          ...DefaultPluginArgs,
          bindHostOrIp: '127.0.0.1',
          proxy: {
            host: '127.0.0.1',
            port: Number(proxyPort),
            auth: { username: 'lab', password: 's3cret' },
          },
        } as any,
        4723,
        'hub-1',
        '',
      );
      restoreRegs = saveRegistrations(HubSessionTokenIssuer);
      Container.set(HubSessionTokenIssuer, {
        tokenFor: async () => null,
        createTokenFor: async () => null,
        controlTokenFor: async () => null,
      } as any);
    });

    afterEach(async () => {
      restoreRegs();
      Object.assign(context, savedContext);
      for (const k of PROXY_ENV) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
      for (const io of ios.splice(0)) io.close();
      for (const wss of sockets.splice(0)) {
        for (const client of wss.clients) client.terminate();
        wss.close();
      }
      await proxy.close();
      await Promise.all(
        servers.splice(0).map(
          (s) =>
            new Promise<void>((resolve) => {
              s.closeAllConnections?.();
              s.close(() => resolve());
            }),
        ),
      );
    });

    /** A server on 127.0.0.1 answering every request with `body`, and its port. */
    async function server(
      body: unknown = {},
      handler?: http.RequestListener,
    ): Promise<{ port: number; asked: string[]; server: http.Server }> {
      const asked: string[] = [];
      const s = http.createServer(
        handler ??
          ((req, res) => {
            asked.push(`${req.method} ${req.url}`);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
          }),
      );
      servers.push(s);
      await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
      return { port: (s.address() as AddressInfo).port, asked, server: s };
    }

    it('a command forwarded to a node, with the proxy credentials', async () => {
      const { port } = await server();
      await readAnswer(
        await sendToNode({
          url: `http://node.test:${port}/wd/session/s/url`,
          method: 'GET',
          headers: {},
        }),
      );
      expect(proxy.seen).to.include(`GET http://node.test:${port}/wd/session/s/url`);
      expect(proxy.authorizations[0]).to.equal(
        `Basic ${Buffer.from('lab:s3cret').toString('base64')}`,
      );
    });

    it("a remote session's own calls (its screenshot)", async () => {
      const { port } = await server({ value: 'iVBOR' });
      const session = new RemoteSession({
        sessionId: 's',
        device: { udid: 'p', host: `http://node.test:${port}` } as any,
        sessionResponse: {},
        xenonOption: {},
        baseUrl: `http://node.test:${port}/wd`,
      });

      expect(await session.getScreenShot()).to.equal('iVBOR');
      expect(proxy.seen).to.include(`GET http://node.test:${port}/wd/session/s/screenshot`);
    });

    it("the lookup of a node's base path", async () => {
      const { port } = await server({ basePath: '/wd' });
      expect(
        await nodeWebDriverUrl({ udid: 'p', host: `http://node.test:${port}` } as any, ''),
      ).to.equal(`http://node.test:${port}/wd`);
      expect(proxy.seen).to.include(`GET http://node.test:${port}/xenon/api/webdriver`);
    });

    it('the create, as before', async () => {
      const { port, asked } = await server(undefined, (req, res) => {
        asked.push(`${req.method} ${req.url}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          req.url === '/xenon/api/webdriver'
            ? JSON.stringify({ basePath: '' })
            : JSON.stringify({ value: { sessionId: 'made', capabilities: {} } }),
        );
      });
      await Container.get(SessionLifecycleService).forwardSessionRequest(
        { udid: 'p', host: `http://node.test:${port}` } as any,
        { alwaysMatch: {}, firstMatch: [{}] } as any,
      );
      expect(proxy.seen).to.include(`POST http://node.test:${port}/session`);
    });

    it('the create, straight to a node NO_PROXY names', async () => {
      // node.test resolves only at the proxy, so going straight there fails:
      // what is tested is that the proxy is never asked.
      process.env.NO_PROXY = 'node.test';
      const created = await Container.get(SessionLifecycleService).forwardSessionRequest(
        { udid: 'p', host: 'http://node.test:9' } as any,
        { alwaysMatch: {}, firstMatch: [{}] } as any,
      );
      expect(created).to.be.instanceOf(Error);
      expect(proxy.seen).to.deep.equal([]);
    });

    it("Xenon's other internal calls (a health probe)", async () => {
      const { port } = await server({ ok: true });
      expect(await isXenonRunning(`http://node.test:${port}`)).to.equal(true);
      expect(proxy.seen).to.include(`GET http://node.test:${port}/xenon/api/health`);
    });

    it("the live-preview and logcat sockets to a node's phone", async () => {
      const { port, server: s } = await server({ ticket: 'node-ticket', expiresIn: 60 });
      const wss = new WebSocketServer({ server: s });
      sockets.push(wss);
      const socket = await openNodeSocket(
        { udid: 'p', actor: { actorId: 'alice' }, path: 'logcat' },
        {
          findDevice: async () => ({
            udid: 'p',
            host: `http://node.test:${port}`,
            nodeId: 'node-1',
          }),
          controlToken: async () => null,
        },
      );
      (socket as WebSocket).terminate();
      expect(proxy.seen).to.include(`CONNECT node.test:${port}`);
    });

    it("a node fetching its hub's keys", async () => {
      const { port } = await server({ keys: [] });
      const token = [
        Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url'),
        Buffer.from(JSON.stringify({ sid: 's' })).toString('base64url'),
        'c2lnbmF0dXJl',
      ].join('.');
      await new HubSessionTokenVerifier(`http://hub.test:${port}`)
        .verify(token, 's')
        .catch(() => undefined);
      expect(proxy.seen).to.include(`GET http://hub.test:${port}/xenon/api/auth/jwks.json`);
    });

    it("a node's live-events connection to its hub", async () => {
      const { port, server: s } = await server();
      ios.push(new IoServer(s));
      const client = new SocketClient();
      try {
        client.initialize(`http://hub.test:${port}`, 'http://node.lab:4723');
        const deadline = Date.now() + 10_000;
        while (!client.isConnected()) {
          if (Date.now() > deadline) throw new Error('the node never connected to its hub');
          await new Promise((r) => setTimeout(r, 25));
        }
      } finally {
        (client as any).socket?.close();
      }
      expect(
        proxy.seen.some((l) => l.startsWith(`GET http://hub.test:${port}/socket.io/`)),
        proxy.seen.join('\n'),
      ).to.equal(true);
    });

    it("but not a session's call to this server, which carries its secret", async () => {
      // Appium bound to a LAN address: the /wd-internal URL isn't a loopback
      // name, so only the session's own `proxy: false` keeps it direct.
      const session = new LocalSession({
        sessionId: 's-1',
        device: { udid: 'p' } as any,
        sessionResponse: {},
        xenonOption: {},
        driver: { opts: { address: 'node.test', port: 9, basePath: '/wd/hub' } },
      });
      await session.getPageSource().catch(() => undefined);
      expect(proxy.seen).to.deep.equal([]);
    });

    it('but not a call to this machine', async () => {
      const { port, asked } = await server({ ok: true });
      expect(await isXenonRunning(`http://127.0.0.1:${port}`)).to.equal(true);
      expect(proxy.seen).to.deep.equal([]);
      expect(asked).to.include('GET /xenon/api/health');
    });
  });

  describe('TLS to the server behind it', () => {
    let proxy: FakeProxy;
    let context: PluginContext;
    let savedContext: Partial<PluginContext>;
    let tlsServer: https.Server;
    let port: number;

    before(async function () {
      this.timeout(60_000);
      tlsServer = https.createServer(selfSignedCertificate('node.test'), (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
      await new Promise<void>((resolve) => tlsServer.listen(0, '127.0.0.1', () => resolve()));
      port = (tlsServer.address() as AddressInfo).port;
    });

    after(async () => {
      await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
    });

    beforeEach(async () => {
      proxy = await startFakeProxy({ hosts: { 'node.test': '127.0.0.1' } });
      context = Container.get(PluginContext);
      savedContext = { ...context };
      const [, proxyPort] = proxy.url.replace('http://', '').split(':');
      context.setContext(
        { ...DefaultPluginArgs, proxy: { host: '127.0.0.1', port: Number(proxyPort) } } as any,
        4723,
        'hub-1',
        '',
      );
    });

    afterEach(async () => {
      Object.assign(context, savedContext);
      await proxy.close();
    });

    it('accepts a self-signed certificate when tlsRejectUnauthorized is false', async () => {
      const answer = await InternalHttpClient.getClient(false).get(`https://node.test:${port}/x`);
      expect(answer.data).to.deep.equal({ ok: true });
      expect(proxy.seen).to.include(`CONNECT node.test:${port}`);
    });

    it('refuses it otherwise', async () => {
      const outcome = await InternalHttpClient.getClient(true)
        .get(`https://node.test:${port}/x`)
        .then(
          () => 'accepted',
          (err) => String(err?.code ?? err?.message),
        );
      expect(outcome).to.not.equal('accepted');
      expect(proxy.seen).to.include(`CONNECT node.test:${port}`);
    });
  });
});

/** A certificate for `host`, signed by its own key: one no client trusts. */
function selfSignedCertificate(host: string): { cert: string; key: string } {
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const subject = [{ name: 'commonName', value: host }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, md.sha256.create());
  return { cert: pki.certificateToPem(cert), key: pki.privateKeyToPem(keys.privateKey) };
}
