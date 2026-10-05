import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import type { AddressInfo } from 'net';
import axios from 'axios';
import { Container } from 'typedi';
import { WebSocket, WebSocketServer } from 'ws';
import { readAnswer, sendToNode } from '../../src/gateway/forwardToNode';
import {
  HubSessionTokenVerifier,
  HubTokenUnavailableError,
} from '../../src/gateway/hubSessionToken';
import { openNodeSocket } from '../../src/app/ws/nodeSocketRelay';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { envProxyFor } from '../../src/helpers/outboundProxy';
import { SocketClient } from '../../src/services/SocketClient';
import { Server as IoServer } from 'socket.io';
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
 * Xenon's axios calls take a proxy from the environment by axios's rule: the
 * URL's own scheme's variable, lower-case name first, unless NO_PROXY names
 * the host. Its other calls to a node didn't:
 * - a forwarded command, device control action, recording relay and socket
 *   ticket took HTTP_PROXY or HTTPS_PROXY whatever the scheme, ignored the
 *   lower-case names and ignored NO_PROXY;
 * - the live-preview and logcat sockets ignored every proxy, after asking for
 *   their ticket through one;
 * - a node fetching its hub's keys (JWKS) ignored every proxy.
 * They all follow axios's rule now.
 */
describe('proxies for the calls Xenon makes to another server', function () {
  this.timeout(20_000);
  let saved: Record<string, string | undefined>;
  let proxy: FakeProxy;
  const servers: http.Server[] = [];

  beforeEach(async () => {
    saved = Object.fromEntries(PROXY_ENV.map((k) => [k, process.env[k]]));
    for (const k of PROXY_ENV) delete process.env[k];
    proxy = await startFakeProxy();
  });

  afterEach(async () => {
    for (const k of PROXY_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
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

  /** What `promise` settled with (its error, if it failed), or 'pending' after `ms`. */
  async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const pending = new Promise((resolve) => {
      timer = setTimeout(() => resolve('pending'), ms);
    });
    try {
      return await Promise.race([
        promise.then(
          (v) => v,
          (e) => e,
        ),
        pending,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A server on 127.0.0.1 that answers everything 200, and its origin. */
  async function target(handler?: http.RequestListener): Promise<string> {
    const server = http.createServer(
      handler ??
        ((_req, res) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
        }),
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  describe('the rule', () => {
    const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

    it("takes the URL's own scheme's variable, the lower-case name first", () => {
      const vars = env({ HTTP_PROXY: 'http://upper:1', http_proxy: 'http://lower:1' });
      expect(envProxyFor('http://node:4723/x', vars)).to.equal('http://lower:1');
      expect(envProxyFor('https://node/x', env({ HTTP_PROXY: 'http://p:1' }))).to.equal(undefined);
      expect(envProxyFor('https://node/x', env({ HTTPS_PROXY: 'http://p:2' }))).to.equal(
        'http://p:2',
      );
      expect(envProxyFor('http://node/x', env({ HTTPS_PROXY: 'http://p:2' }))).to.equal(undefined);
    });

    it("treats a WebSocket URL as its scheme's HTTP counterpart", () => {
      expect(envProxyFor('ws://node/x', env({ HTTP_PROXY: 'http://p:1' }))).to.equal('http://p:1');
      expect(envProxyFor('wss://node/x', env({ HTTPS_PROXY: 'http://p:2' }))).to.equal(
        'http://p:2',
      );
    });

    it('takes none for a host NO_PROXY names: *, the host, or a .suffix of it', () => {
      const proxied = { HTTP_PROXY: 'http://p:1' };
      const via = (noProxy: string, url = 'http://node.lab.example:4723/x') =>
        envProxyFor(url, env({ ...proxied, NO_PROXY: noProxy }));
      expect(via('*')).to.equal(undefined);
      expect(via('other, node.lab.example')).to.equal(undefined);
      expect(via('.lab.example')).to.equal(undefined);
      expect(via('lab.example')).to.equal('http://p:1');
      expect(via('node.lab.example:4723')).to.equal('http://p:1');
      expect(
        envProxyFor('http://node/x', env({ ...proxied, no_proxy: 'node', NO_PROXY: 'x' })),
      ).to.equal(undefined);
    });
  });

  describe('a call to a node takes the path an axios call takes', () => {
    const cases: Array<{ name: string; vars: (proxyUrl: string) => Record<string, string> }> = [
      { name: 'HTTP_PROXY', vars: (p) => ({ HTTP_PROXY: p }) },
      { name: 'http_proxy', vars: (p) => ({ http_proxy: p }) },
      {
        name: 'HTTP_PROXY, NO_PROXY naming the node',
        vars: (p) => ({ HTTP_PROXY: p, NO_PROXY: '127.0.0.1' }),
      },
      { name: 'HTTP_PROXY, no_proxy=*', vars: (p) => ({ HTTP_PROXY: p, no_proxy: '*' }) },
      {
        name: 'HTTP_PROXY, NO_PROXY listing the node second',
        vars: (p) => ({ HTTP_PROXY: p, NO_PROXY: 'hub.lab, 127.0.0.1' }),
      },
      { name: 'only HTTPS_PROXY, for an http node', vars: (p) => ({ HTTPS_PROXY: p }) },
    ];

    for (const { name, vars } of cases) {
      it(name, async () => {
        Object.assign(process.env, vars(proxy.url));
        const node = await target();

        await axios.get(`${node}/by-axios`);
        await readAnswer(await sendToNode({ url: `${node}/by-xenon`, method: 'GET', headers: {} }));

        const axiosProxied = proxy.seen.includes(`GET ${node}/by-axios`);
        const xenonProxied = proxy.seen.includes(`GET ${node}/by-xenon`);
        expect(xenonProxied, `forwarded call via the proxy (axios: ${axiosProxied})`).to.equal(
          axiosProxied,
        );
      });
    }
  });

  describe("a node fetching its hub's keys", () => {
    // A JWS that parses, so jose asks the key set for its key.
    const token = [
      Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sid: 's' })).toString('base64url'),
      'c2lnbmF0dXJl',
    ].join('.');

    async function fetchKeys(hub: string) {
      await new HubSessionTokenVerifier(hub).verify(token, 's').catch(() => undefined);
    }

    it('goes through the proxy', async () => {
      const hub = await target((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"keys":[]}');
      });
      process.env.HTTP_PROXY = proxy.url;

      await fetchKeys(hub);

      expect(proxy.seen).to.include(`GET ${hub}/xenon/api/auth/jwks.json`);
    });

    it('gives up in its time when the proxy never answers', async () => {
      // The fetch's own timeout starts once the request has a socket, which a
      // proxy agent hands it only after its CONNECT is answered.
      await proxy.close();
      proxy = await startFakeProxy({ ignoreConnect: true });
      process.env.HTTPS_PROXY = proxy.url;

      const outcome = await settlesWithin(
        new HubSessionTokenVerifier('https://hub.lab.example:4723', undefined, {
          timeoutMs: 300,
        }).verify(token, 's'),
        3_000,
      );

      expect(outcome).to.be.instanceOf(HubTokenUnavailableError);
    });

    it('goes straight to a hub NO_PROXY names', async () => {
      const asked: string[] = [];
      const hub = await target((req, res) => {
        asked.push(String(req.url));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"keys":[]}');
      });
      process.env.HTTP_PROXY = proxy.url;
      process.env.NO_PROXY = '127.0.0.1';

      await fetchKeys(hub);

      expect(proxy.seen).to.deep.equal([]);
      expect(asked).to.include('/xenon/api/auth/jwks.json');
    });
  });

  describe("a node's live-events connection to its hub", () => {
    let client: SocketClient | undefined;
    let hubIo: IoServer | undefined;

    afterEach(() => {
      (client as any)?.socket?.close();
      client = undefined;
      hubIo?.close();
      hubIo = undefined;
    });

    async function connect(): Promise<string> {
      const hub = await target();
      hubIo = new IoServer(servers[servers.length - 1]);
      client = new SocketClient();
      client.initialize(hub, 'http://node.lab:4723');
      const deadline = Date.now() + 10_000;
      while (!client.isConnected()) {
        if (Date.now() > deadline) throw new Error('the node never connected to its hub');
        await new Promise((r) => setTimeout(r, 25));
      }
      return hub;
    }

    it('goes through the proxy: polling as plain requests, as axios sends them', async () => {
      process.env.HTTP_PROXY = proxy.url;

      const hub = await connect();

      expect(
        proxy.seen.some((s) => s.startsWith(`GET ${hub}/socket.io/?EIO=4&transport=polling`)),
        proxy.seen.join('\n'),
      ).to.equal(true);
    });

    it('stays connected through a proxy that refuses tunnels, by polling', async () => {
      // A stock Squid refuses CONNECT to any port but 443, and a node's hub
      // is on 4723: the WebSocket upgrade fails, polling carries on.
      await proxy.close();
      proxy = await startFakeProxy({ refuseConnect: true });
      process.env.HTTP_PROXY = proxy.url;

      await connect();

      expect(client?.isConnected()).to.equal(true);
    });

    it('goes straight to a hub NO_PROXY names', async () => {
      process.env.HTTP_PROXY = proxy.url;
      process.env.NO_PROXY = '127.0.0.1';

      await connect();

      expect(proxy.seen).to.deep.equal([]);
    });
  });

  describe("the live-preview and logcat sockets to a node's phone", () => {
    let context: PluginContext;
    let savedContext: Partial<PluginContext>;
    const sockets: WebSocketServer[] = [];

    beforeEach(() => {
      context = Container.get(PluginContext);
      savedContext = { ...context };
      context.setContext(
        { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any,
        1,
        'hub-1',
        '',
      );
    });

    afterEach(() => {
      Object.assign(context, savedContext);
      for (const wss of sockets.splice(0)) {
        for (const client of wss.clients) client.terminate();
        wss.close();
      }
    });

    async function nodeWithSocket(): Promise<string> {
      const origin = await target((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ticket: 'node-ticket', expiresIn: 60 }));
      });
      const wss = new WebSocketServer({ server: servers[servers.length - 1] });
      sockets.push(wss);
      return origin;
    }

    async function open(origin: string): Promise<void> {
      const socket = await openNodeSocket(
        { udid: 'p', actor: { actorId: 'alice' }, path: 'logcat' },
        {
          findDevice: async () => ({ udid: 'p', host: origin, nodeId: 'node-1' }),
          controlToken: async () => null,
        },
      );
      (socket as WebSocket).terminate();
    }

    it('take the proxy their ticket takes', async () => {
      const node = await nodeWithSocket();
      process.env.HTTP_PROXY = proxy.url;

      await open(node);

      expect(proxy.seen).to.include(`POST ${node}/xenon/api/control/p/stream/ticket`);
      expect(proxy.seen).to.include(`CONNECT ${node.replace('http://', '')}`);
    });

    it('go straight to the node when the proxy refuses a tunnel, as they did before', async () => {
      await proxy.close();
      proxy = await startFakeProxy({ refuseConnect: true });
      const node = await nodeWithSocket();
      process.env.HTTP_PROXY = proxy.url;

      await open(node);

      expect(proxy.seen).to.include(`CONNECT ${node.replace('http://', '')}`);
    });

    it('give up in their time when the proxy never answers the tunnel', async () => {
      await proxy.close();
      proxy = await startFakeProxy({ ignoreConnect: true });
      const node = await nodeWithSocket();
      process.env.HTTP_PROXY = proxy.url;

      const outcome = await settlesWithin(
        openNodeSocket(
          { udid: 'p', actor: { actorId: 'alice' }, path: 'logcat' },
          {
            findDevice: async () => ({ udid: 'p', host: node, nodeId: 'node-1' }),
            controlToken: async () => null,
            timeoutMs: 300,
          },
        ),
        3_000,
      );

      expect(outcome).to.be.instanceOf(Error);
    });

    it('go straight to a node NO_PROXY names', async () => {
      const node = await nodeWithSocket();
      process.env.HTTP_PROXY = proxy.url;
      process.env.NO_PROXY = '127.0.0.1';

      await open(node);

      expect(proxy.seen).to.deep.equal([]);
    });
  });
});
