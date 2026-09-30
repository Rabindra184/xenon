import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import { EventEmitter } from 'events';
import type { AddressInfo } from 'net';
import express from 'express';
import { Container } from 'typedi';
import { WebSocket, WebSocketServer } from 'ws';
import { loopbackServers } from '../helpers/loopbackServer';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { NodeSocketRefused, openNodeSocket, relaySocket } from '../../src/app/ws/nodeSocketRelay';
import { attachH264Ws } from '../../src/app/ws/h264StreamWs';
import { attachLogcatWs } from '../../src/app/ws/logcatWs';
import type { ControlDevice } from '../../src/middleware/controlDevice';

/**
 * The H.264 and logcat sockets for a node's phone, on a hub: the hub checks
 * its own ticket, opens the same socket on the node with a ticket of the
 * node's own, and relays it. Frames and close codes pass unchanged, and a
 * viewer that falls behind holds the node back rather than growing the
 * hub's memory, so the node's own slow-viewer rule applies (dropped H.264
 * frames, a visible "lines dropped" record in logcat).
 */

const opened = (ws: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
const closed = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
const nextMessage = (ws: WebSocket) =>
  new Promise<{ data: Buffer; isBinary: boolean }>((resolve) =>
    ws.once('message', (data, isBinary) => resolve({ data: data as Buffer, isBinary })),
  );
/** An upstream socket as openNodeSocket hands one over: open and paused. */
const nodeSocketAt = async (url: string) => {
  const up = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    up.once('open', () => {
      up.pause();
      resolve();
    });
    up.once('error', reject);
  });
  return up;
};

describe('nodeSocketRelay', () => {
  const loopback = loopbackServers();
  const sockets: WebSocketServer[] = [];
  let context: PluginContext;
  let saved: Partial<PluginContext>;

  beforeEach(() => {
    context = Container.get(PluginContext);
    saved = { ...context };
    context.setContext({ ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any, 1, 'hub-1', '');
  });

  afterEach(async () => {
    Object.assign(context, saved);
    for (const wss of sockets.splice(0)) {
      for (const client of wss.clients) client.terminate();
      wss.close();
    }
    await loopback.closeAll();
  });

  /** A node: a ticket route and a socket on the same server. */
  async function fakeNode(
    opts: { ticketStatus?: number; onSocket?: (ws: WebSocket, url: string) => void } = {},
  ) {
    const seen: { url: string; hubToken?: string }[] = [];
    const app = express();
    app.post('/xenon/api/control/:udid/stream/ticket', (req, res) => {
      seen.push({ url: req.originalUrl, hubToken: req.header('x-xenon-hub-token') });
      res.status(opts.ticketStatus ?? 200).json({ ticket: 'node-ticket', expiresIn: 60 });
    });
    const server = await loopback.serve(app);
    const wss = new WebSocketServer({ server });
    sockets.push(wss);
    wss.on('connection', (ws, req) => {
      seen.push({ url: req.url as string });
      opts.onSocket?.(ws, req.url as string);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { origin, seen, wss };
  }

  /** A hub socket whose connections are relayed to `upstream()`. */
  async function relayingHub(upstream: () => Promise<WebSocket>, highWaterBytes?: number) {
    const server = await loopback.serve(express());
    const wss = new WebSocketServer({ server });
    sockets.push(wss);
    wss.on('connection', async (client) => {
      relaySocket(client, await upstream(), highWaterBytes);
    });
    return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  describe('relaySocket', () => {
    it('passes messages both ways, binary and text as they were', async () => {
      let atNode!: WebSocket;
      const node = await fakeNode({ onSocket: (ws) => (atNode = ws) });
      const hub = await relayingHub(() => nodeSocketAt(`${node.origin.replace('http', 'ws')}/x`));
      const viewer = new WebSocket(hub);
      await opened(viewer);
      await new Promise((r) => setTimeout(r, 50));

      const binary = nextMessage(viewer);
      atNode.send(Buffer.from([1, 2, 3]));
      expect(await binary).to.deep.equal({ data: Buffer.from([1, 2, 3]), isBinary: true });
      const text = nextMessage(viewer);
      atNode.send('{"message":"a line"}');
      const got = await text;
      expect(got.isBinary).to.equal(false);
      expect(got.data.toString()).to.equal('{"message":"a line"}');

      const fromViewer = nextMessage(atNode);
      viewer.send('hello');
      expect((await fromViewer).data.toString()).to.equal('hello');
      viewer.close();
    });

    it('closes the viewer with the node’s own code and reason', async () => {
      for (const [code, reason] of [
        [1012, 'stream ended'],
        [1008, 'device held by another user'],
        [1011, 'stream failed'],
      ] as const) {
        const node = await fakeNode({
          onSocket: (ws) => setTimeout(() => ws.close(code, reason), 30),
        });
        const hub = await relayingHub(() => nodeSocketAt(`${node.origin.replace('http', 'ws')}/x`));
        const viewer = new WebSocket(hub);
        expect(await closed(viewer)).to.deep.equal({ code, reason });
      }
    });

    it('a node connection that drops is 1011 to the viewer, who retries', async () => {
      const node = await fakeNode({ onSocket: (ws) => setTimeout(() => ws.terminate(), 30) });
      const hub = await relayingHub(() => nodeSocketAt(`${node.origin.replace('http', 'ws')}/x`));
      const viewer = new WebSocket(hub);
      expect((await closed(viewer)).code).to.equal(1011);
    });

    it('the viewer leaving closes the node’s socket', async () => {
      let atNode!: WebSocket;
      const node = await fakeNode({ onSocket: (ws) => (atNode = ws) });
      const hub = await relayingHub(() => nodeSocketAt(`${node.origin.replace('http', 'ws')}/x`));
      const viewer = new WebSocket(hub);
      await opened(viewer);
      await new Promise((r) => setTimeout(r, 50));
      const nodeClosed = closed(atNode);
      viewer.close();
      await nodeClosed;
    });

    it('stops reading from the node while the viewer is behind, and resumes once it catches up', () => {
      class FakeSocket extends EventEmitter {
        readyState = WebSocket.OPEN;
        paused = false;
        pending: (() => void)[] = [];
        send(_data: unknown, _opts: unknown, cb: () => void) {
          this.pending.push(cb);
        }
        pause() {
          this.paused = true;
        }
        resume() {
          this.paused = false;
        }
        close() {}
        terminate() {}
      }
      const viewer = new FakeSocket();
      const node = new FakeSocket();
      relaySocket(viewer as any, node as any, 100);

      node.emit('message', Buffer.alloc(60), true);
      expect(node.paused).to.equal(false);
      node.emit('message', Buffer.alloc(60), true);
      expect(node.paused, '120 bytes unwritten').to.equal(true);
      const written = () => (viewer.pending.shift() as () => void)();
      written();
      expect(node.paused, '60 bytes unwritten').to.equal(true);
      written();
      expect(node.paused, 'all written').to.equal(false);
    });
  });

  describe('openNodeSocket', () => {
    const actor = { actorId: 'alice', isAdmin: false };

    it('is null for this server’s own phone, and asks nothing of anyone', async () => {
      const node = await fakeNode();
      const socket = await openNodeSocket(
        { udid: 'p', actor, path: 'stream/h264' },
        { findDevice: async () => ({ udid: 'p', host: node.origin, nodeId: 'hub-1' }) },
      );
      expect(socket).to.equal(null);
      expect(node.seen).to.deep.equal([]);
    });

    it('opens the node’s socket with a ticket of the node’s own, asked for with the hub’s token', async () => {
      const node = await fakeNode();
      const socket = await openNodeSocket(
        {
          udid: 'a b',
          actor,
          path: 'logcat',
          query: new URLSearchParams({ levels: 'error', process: 'App' }),
        },
        {
          findDevice: async () => ({ udid: 'a b', host: node.origin, nodeId: 'node-1' }),
          controlToken: async () => 'signed-for-alice',
        },
      );
      expect(socket).to.be.instanceOf(WebSocket);
      (socket as WebSocket).close();
      expect(node.seen).to.deep.equal([
        { url: '/xenon/api/control/a%20b/stream/ticket', hubToken: 'signed-for-alice' },
        { url: '/xenon/api/control/a%20b/logcat?levels=error&process=App&ticket=node-ticket' },
      ]);
    });

    it('holds what the node sends first until something reads it', async () => {
      // H.264's config packet and logcat's replay go out the moment the
      // node's socket opens; lost, the preview never decodes.
      const node = await fakeNode({ onSocket: (ws) => ws.send('first frame') });
      const socket = await openNodeSocket(
        { udid: 'p', actor, path: 'stream/h264' },
        {
          findDevice: async () => ({ udid: 'p', host: node.origin, nodeId: 'node-1' }),
          controlToken: async () => null,
        },
      );
      const up = socket as WebSocket;
      await new Promise((r) => setTimeout(r, 100));
      const first = nextMessage(up);
      up.resume();
      expect((await first).data.toString()).to.equal('first frame');
      up.close();
    });

    it('a node that refuses the ticket is a refusal, one that can’t be reached is not', async () => {
      const refusing = await fakeNode({ ticketStatus: 409 });
      const find = (host: string) => async (): Promise<ControlDevice> => ({
        udid: 'p',
        host,
        nodeId: 'node-1',
      });
      let error: any;
      await openNodeSocket(
        { udid: 'p', actor, path: 'stream/h264' },
        { findDevice: find(refusing.origin), controlToken: async () => null },
      ).catch((e) => (error = e));
      expect(error).to.be.instanceOf(NodeSocketRefused);

      error = undefined;
      await openNodeSocket(
        { udid: 'p', actor, path: 'stream/h264' },
        { findDevice: find('http://127.0.0.1:1'), controlToken: async () => null },
      ).catch((e) => (error = e));
      expect(error).to.be.instanceOf(Error);
      expect(error).to.not.be.instanceOf(NodeSocketRefused);
    });

    it('a cloud provider’s phone is refused without a request', async () => {
      const node = await fakeNode();
      let error: any;
      await openNodeSocket(
        { udid: 'p', actor, path: 'stream/h264' },
        {
          findDevice: async () => ({ udid: 'p', host: node.origin, cloud: '{"cloudName":"x"}' }),
        },
      ).catch((e) => (error = e));
      expect(error).to.be.instanceOf(NodeSocketRefused);
      expect(node.seen).to.deep.equal([]);
    });
  });

  describe('the hub’s own sockets', () => {
    async function hubWith(attach: (server: http.Server) => void) {
      const server = http.createServer();
      attach(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      loopbackServersCleanup.push(server);
      return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
    const loopbackServersCleanup: http.Server[] = [];
    afterEach(async () => {
      for (const s of loopbackServersCleanup.splice(0)) {
        s.closeAllConnections?.();
        await new Promise((r) => s.close(r));
      }
    });

    it('H.264: a node’s phone is relayed from its node, with the ticket’s user', async () => {
      const node = await fakeNode({ onSocket: (ws) => ws.send(Buffer.from([0, 9, 9])) });
      const asked: unknown[] = [];
      const hub = await hubWith((server) =>
        attachH264Ws(server, {
          redeem: async () => ({ actorId: 'alice', isAdmin: true }),
          startStream: async () => {
            throw new Error('not this server’s phone');
          },
          nodeSocket: async (udid, who) => {
            asked.push({ udid, who });
            return nodeSocketAt(`${node.origin.replace('http', 'ws')}/h264`);
          },
        }),
      );
      const viewer = new WebSocket(`${hub}/xenon/api/control/p/stream/h264?ticket=t`);
      expect((await nextMessage(viewer)).data).to.deep.equal(Buffer.from([0, 9, 9]));
      expect(asked).to.deep.equal([{ udid: 'p', who: { actorId: 'alice', isAdmin: true } }]);
      viewer.close();
    });

    it('H.264: a refusal from the node is 1008, anything else 1011', async () => {
      for (const [thrown, code] of [
        [new NodeSocketRefused('the node refused the ticket'), 1008],
        [new Error('ECONNREFUSED'), 1011],
      ] as const) {
        const hub = await hubWith((server) =>
          attachH264Ws(server, {
            redeem: async () => ({ actorId: 'alice' }),
            startStream: async () => {
              throw new Error('not this server’s phone');
            },
            nodeSocket: async () => {
              throw thrown;
            },
          }),
        );
        const viewer = new WebSocket(`${hub}/xenon/api/control/p/stream/h264?ticket=t`);
        expect((await closed(viewer)).code).to.equal(code);
      }
    });

    it('logcat: relayed after this server’s own ownership check, with the filter', async () => {
      const node = await fakeNode({ onSocket: (ws) => ws.send('{"message":"from the node"}') });
      const asked: unknown[] = [];
      let authorized = 0;
      const hub = await hubWith((server) =>
        attachLogcatWs(server, {
          redeem: async () => ({ actorId: 'alice' }),
          authorize: async () => {
            authorized++;
            return true;
          },
          startStream: async () => {
            throw new Error('not this server’s phone');
          },
          nodeSocket: async (udid, who, filter) => {
            asked.push({ udid, filter });
            return nodeSocketAt(`${node.origin.replace('http', 'ws')}/logcat`);
          },
        }),
      );
      const viewer = new WebSocket(
        `${hub}/xenon/api/control/p/logcat?ticket=t&levels=error&process=App`,
      );
      expect((await nextMessage(viewer)).data.toString()).to.equal('{"message":"from the node"}');
      expect(authorized).to.equal(1);
      expect(asked).to.deep.equal([{ udid: 'p', filter: { levels: ['error'], process: 'App' } }]);
      viewer.close();
    });

    it('logcat: a phone this server may not show isn’t asked of the node', async () => {
      let asked = 0;
      const hub = await hubWith((server) =>
        attachLogcatWs(server, {
          redeem: async () => ({ actorId: 'bob' }),
          authorize: async () => false,
          startStream: async () => {
            throw new Error('unused');
          },
          nodeSocket: async () => {
            asked++;
            return null;
          },
        }),
      );
      const viewer = new WebSocket(`${hub}/xenon/api/control/p/logcat?ticket=t`);
      expect((await closed(viewer)).code).to.equal(1008);
      expect(asked).to.equal(0);
    });
  });
});
