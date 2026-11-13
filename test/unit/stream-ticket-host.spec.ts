import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { WebSocket, WebSocketServer } from 'ws';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { saveRegistrations } from '../helpers/container-registration';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import { useScratchDatabase } from '../helpers/scratch-database';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { XenonManager } from '../../src/device-managers';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import * as forwardToNode from '../../src/gateway/forwardToNode';
import { ticketPhone, type ControlDevice } from '../../src/middleware/controlDevice';
import { openNodeSocket } from '../../src/app/ws/nodeSocketRelay';
import { attachH264Ws } from '../../src/app/ws/h264StreamWs';
import { attachLogcatWs } from '../../src/app/ws/logcatWs';
import { makeTicketActorAuthorizer } from '../../src/services/device-access/ticketActorAccess';
import { H264Multiplexer } from '../../src/device-managers/android/H264Multiplexer';

/**
 * A stream ticket names its phone by udid and host (the spec's "Tickets and
 * sockets"). Tickets are team-checked only when minted, so whatever redeems
 * one (the MJPEG `GET stream?ticket=`, the H.264 and logcat sockets, the
 * hub's relay to a node) acts on the phone the ticket's host names, and
 * nothing else: a hub and its node can both report emulator-5554.
 */

const UDID = 'emulator-5554';
// The same length as UDID, so an answer that echoes the path is the same
// length for both.
const UNKNOWN = 'emulator-9999';
const HUB = 'http://hub:4723';
const NODE = 'http://node:4723';

/** The claims of a signed ticket, read without verifying it. */
function claimsOf(ticket: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(ticket.split('.')[1], 'base64url').toString('utf8'));
}

describe('stream tickets carry the phone host', () => {
  useScratchDatabase();
  useOwnNodeId();
  const loopback = loopbackServers();
  let dir: string;
  let tickets: StreamTicketService;
  let restore: () => void;

  beforeEach(async () => {
    restore = saveRegistrations(
      JwtKeyService,
      StreamTicketService,
      UserService,
      ApiKeyService,
      UserSessionService,
      XenonManager,
      HubSessionTokenIssuer,
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-ticket-host-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    tickets = new StreamTicketService();
    Container.set(StreamTicketService, tickets);
    Container.set(UserService, { findById: sinon.stub().resolves(null) } as any);
    // No credential verifies; scopes are judged as the real service judges them.
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      verify: sinon.stub().resolves(null),
      hasScope: (row: any, required: any) => ApiKeyService.prototype.hasScope(row, required),
    } as any);
    Container.set(UserSessionService, { resolve: sinon.stub().resolves(null) } as any);
    Container.set(XenonManager, { deviceInstances: async () => [] } as any);
    Container.set(HubSessionTokenIssuer, { controlTokenFor: async () => null } as any);
  });

  afterEach(async () => {
    sinon.restore();
    restore();
    await loopback.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('StreamTicketService', () => {
    it('signs the host it is given beside the udid', async () => {
      const ticket = await tickets.mint(UDID, 'usr_1', {}, NODE);
      expect(claimsOf(ticket)).to.include({ udid: UDID, host: NODE });
    });

    it('refuses a host other than the ticket’s, and spends nothing doing so', async () => {
      const ticket = await tickets.mint(UDID, 'usr_1', {}, NODE);
      let error: any;
      await tickets.redeem(ticket, UDID, HUB).catch((e) => (error = e));
      expect(error, 'a different host').to.be.instanceOf(Error);
      expect(error.message).to.match(/host/);
      const out = await tickets.redeem(ticket, UDID, NODE);
      expect(out).to.deep.equal({ actorId: 'usr_1', isAdmin: false, host: NODE });
    });

    it('answers the ticket’s host when asked with none', async () => {
      const ticket = await tickets.mint(UDID, 'usr_1', {}, NODE);
      expect((await tickets.redeem(ticket, UDID)).host).to.equal(NODE);
    });

    it('redeems a ticket minted without a host with any host or none, and names none', async () => {
      const old = await tickets.mint(UDID, 'usr_1');
      expect(claimsOf(old)).to.not.have.property('host');
      expect(await tickets.redeem(old, UDID, HUB)).to.deep.equal({
        actorId: 'usr_1',
        isAdmin: false,
      });
      const another = await tickets.mint(UDID, 'usr_1');
      expect(await tickets.redeem(another, UDID)).to.not.have.property('host');
    });
  });

  describe('through /control', () => {
    // This server's own emulator-5554, and its node's.
    const rows = (): ControlDevice[] =>
      [
        { udid: UDID, host: NODE, nodeId: 'node-1', teamId: null, busy: false } as any,
        { udid: UDID, host: HUB, nodeId: OWN_NODE_ID, teamId: null, busy: false } as any,
      ].map((r) => ({ ...r, platform: 'android', screenWidth: 1080, screenHeight: 1920 }));
    let forwarded: string[];
    let nodeSaw: string[];

    beforeEach(async () => {
      sinon.stub(DeviceStoreFactory, 'getStore').returns({
        findDevices: async (filter: any) =>
          rows().filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
        // The udid's first row is the node's: anything still reading by udid
        // alone gets it.
        findDevice: async (filter: any) =>
          rows().find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ?? null,
      } as any);
      nodeSaw = [];
      const node = express();
      node.use((req, res) => {
        nodeSaw.push(req.originalUrl);
        res.json({ from: 'node' });
      });
      const server = await loopback.serve(node);
      const nodeOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      forwarded = [];
      const send = forwardToNode.sendToNode;
      sinon.stub(forwardToNode, 'sendToNode').callsFake((call) => {
        forwarded.push(call.url);
        return send({ ...call, url: call.url.replace(NODE, nodeOrigin) });
      });
    });

    /**
     * The API as src/app/index.ts mounts it: authMiddleware, then /control.
     * A request with `x-test-admin` is a signed-in admin instead.
     */
    function app() {
      const app = express();
      app.use(express.json());
      const api = express.Router();
      api.use((req, res, next) => {
        if (!req.header('x-test-admin')) return authMiddleware(req, res, next);
        (req as any).auth = {
          kind: 'user-session',
          userId: 'usr_admin',
          role: 'ADMIN',
          scopes: 'admin,devices,sessions,read',
          rateLimit: 100,
          teamIds: undefined,
        };
        next();
      });
      ControlRouter.register(api);
      api.use('*', (req, res) => {
        res.status(404).json({
          error: true,
          message: `API endpoint ${req.method} ${req.originalUrl} not found`,
        });
      });
      app.use('/xenon/api', api);
      return app;
    }

    async function mintThrough(host: string): Promise<string> {
      const res = await request(app())
        .post(`/xenon/api/control/${UDID}/stream/ticket?host=${encodeURIComponent(host)}`)
        .set('x-test-admin', '1')
        .send({});
      expect(res.status, res.text).to.equal(200);
      return res.body.ticket;
    }

    it('mints with the host of the phone the request resolved to', async () => {
      expect(claimsOf(await mintThrough(NODE))).to.include({ udid: UDID, host: NODE });
      expect(claimsOf(await mintThrough(HUB))).to.include({ udid: UDID, host: HUB });
      expect(forwarded, 'a ticket is answered here').to.deep.equal([]);
    });

    it('sends the MJPEG stream of a node-host ticket to that node, without the ticket', async () => {
      const ticket = await mintThrough(NODE);
      const res = await request(app()).get(`/xenon/api/control/${UDID}/stream?ticket=${ticket}`);
      expect(res.status, res.text).to.equal(200);
      expect(res.body).to.deep.equal({ from: 'node' });
      expect(forwarded).to.deep.equal([`${NODE}/xenon/api/control/${UDID}/stream`]);
      expect(nodeSaw).to.deep.equal([`/xenon/api/control/${UDID}/stream`]);
    });

    it('answers a ?host= other than the ticket’s exactly as an unknown udid', async () => {
      const q = `&host=${encodeURIComponent(HUB)}`;
      const named = await request(app()).get(
        `/xenon/api/control/${UDID}/stream?ticket=${await mintThrough(NODE)}${q}`,
      );
      const unknown = await request(app()).get(
        `/xenon/api/control/${UNKNOWN}/stream?ticket=${await tickets.mint(
          UNKNOWN,
          'usr_admin',
          { isAdmin: true },
          NODE,
        )}${q}`,
      );
      expect(named.status, named.text).to.equal(404);
      expect(named.text.split(UDID).join('<udid>')).to.equal(
        unknown.text.split(UNKNOWN).join('<udid>'),
      );
      expect(forwarded).to.deep.equal([]);
    });

    it('answers a host-less ticket for a udid two servers have as an unknown udid', async () => {
      const old = await tickets.mint(UDID, 'usr_admin', { isAdmin: true });
      const res = await request(app()).get(`/xenon/api/control/${UDID}/stream?ticket=${old}`);
      expect(res.status, res.text).to.equal(404);
      expect(res.text).to.not.include(HUB);
      expect(res.text).to.not.include(NODE);
      expect(forwarded).to.deep.equal([]);
    });
  });

  describe('the H.264 and logcat sockets', () => {
    const sockets: WebSocketServer[] = [];
    const servers: http.Server[] = [];
    afterEach(async () => {
      for (const wss of sockets.splice(0)) {
        for (const client of wss.clients) client.terminate();
        wss.close();
      }
      for (const s of servers.splice(0)) {
        s.closeAllConnections?.();
        await new Promise((r) => s.close(r));
      }
    });

    /** A node with a ticket route and a socket that greets with its name. */
    async function fakeNode(name: string) {
      const seen: string[] = [];
      const app = express();
      app.post('/xenon/api/control/:udid/stream/ticket', (req, res) => {
        seen.push(req.originalUrl);
        res.json({ ticket: `${name}-ticket`, expiresIn: 60 });
      });
      const server = await loopback.serve(app);
      const wss = new WebSocketServer({ server });
      sockets.push(wss);
      wss.on('connection', (ws, req) => {
        seen.push(req.url as string);
        ws.send(`from ${name}`);
      });
      return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
    }

    async function serve(attach: (server: http.Server) => void) {
      const server = http.createServer();
      attach(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    const firstMessage = (ws: WebSocket) =>
      new Promise<string>((resolve, reject) => {
        ws.once('message', (data) => resolve(data.toString()));
        ws.once('close', (code) => reject(new Error(`closed ${code}`)));
      });
    const closeOf = (ws: WebSocket) =>
      new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));

    /** Two nodes with emulator-5554, and this server's own. */
    async function lab() {
      const a = await fakeNode('a');
      const b = await fakeNode('b');
      const rows: ControlDevice[] = [
        { udid: UDID, host: a.origin, nodeId: 'node-a', busy: false },
        { udid: UDID, host: b.origin, nodeId: 'node-b', busy: false },
        { udid: UDID, host: HUB, nodeId: OWN_NODE_ID, busy: false },
      ];
      const findRows = async (udid: string) => rows.filter((r) => r.udid === udid);
      return { a, b, findRows };
    }

    /** The two sockets as ServerManager wires them, over `findRows`. */
    function wired(findRows: (udid: string) => Promise<ControlDevice[]>) {
      const started: string[] = [];
      const relay = { findRows, controlToken: async () => null };
      const h264 = (server: http.Server) =>
        attachH264Ws(server, {
          redeem: (ticket, udid) => tickets.redeem(ticket, udid),
          startStream: async (udid) => {
            started.push(`h264:${udid}`);
            return new H264Multiplexer();
          },
          nodeSocket: (udid, actor) =>
            openNodeSocket({ udid, host: actor.host, actor, path: 'stream/h264' }, relay),
        });
      const logcat = (server: http.Server) =>
        attachLogcatWs(server, {
          redeem: (ticket, udid) => tickets.redeem(ticket, udid),
          authorize: makeTicketActorAuthorizer({
            findDevice: (udid, host) => ticketPhone(udid, host, findRows),
            resolveSessionOwner: async () => null,
          }),
          startStream: async (udid) => {
            started.push(`logcat:${udid}`);
            throw new Error('not served here in this spec');
          },
          nodeSocket: (udid, actor, filter) =>
            openNodeSocket(
              {
                udid,
                host: actor.host,
                actor,
                path: 'logcat',
                query: new URLSearchParams(
                  filter.levels ? { levels: filter.levels.join(',') } : {},
                ),
              },
              relay,
            ),
        });
      return { h264, logcat, started };
    }

    it('H.264: opens the socket on the node the ticket’s host names', async () => {
      const { a, b, findRows } = await lab();
      const { h264, started } = wired(findRows);
      const hub = await serve(h264);
      const ticket = await tickets.mint(UDID, 'usr_1', {}, b.origin);
      const viewer = new WebSocket(`${hub}/xenon/api/control/${UDID}/stream/h264?ticket=${ticket}`);
      expect(await firstMessage(viewer)).to.equal('from b');
      viewer.close();
      expect(a.seen, 'the other node is asked nothing').to.deep.equal([]);
      expect(b.seen).to.deep.equal([
        `/xenon/api/control/${UDID}/stream/ticket`,
        `/xenon/api/control/${UDID}/stream/h264?ticket=b-ticket`,
      ]);
      expect(started).to.deep.equal([]);
    });

    it('logcat: checks and opens the phone the ticket’s host names', async () => {
      const { a, b, findRows } = await lab();
      const { logcat, started } = wired(findRows);
      const hub = await serve(logcat);
      const ticket = await tickets.mint(UDID, 'usr_1', {}, a.origin);
      const viewer = new WebSocket(
        `${hub}/xenon/api/control/${UDID}/logcat?ticket=${ticket}&levels=error`,
      );
      expect(await firstMessage(viewer)).to.equal('from a');
      viewer.close();
      expect(b.seen).to.deep.equal([]);
      expect(a.seen).to.deep.equal([
        `/xenon/api/control/${UDID}/stream/ticket`,
        `/xenon/api/control/${UDID}/logcat?levels=error&ticket=a-ticket`,
      ]);
      expect(started).to.deep.equal([]);
    });

    it('H.264: serves this server’s own phone here when the ticket names it', async () => {
      const { a, b, findRows } = await lab();
      const { h264, started } = wired(findRows);
      const hub = await serve(h264);
      const ticket = await tickets.mint(UDID, 'usr_1', {}, HUB);
      const viewer = new WebSocket(`${hub}/xenon/api/control/${UDID}/stream/h264?ticket=${ticket}`);
      await new Promise((resolve, reject) => {
        viewer.once('open', resolve);
        viewer.once('error', reject);
      });
      for (let i = 0; i < 50 && started.length === 0; i++)
        await new Promise((r) => setTimeout(r, 10));
      expect(started).to.deep.equal([`h264:${UDID}`]);
      expect(a.seen).to.deep.equal([]);
      expect(b.seen).to.deep.equal([]);
      viewer.close();
    });

    for (const kind of ['stream/h264', 'logcat'] as const) {
      const socketOf = (w: ReturnType<typeof wired>) => (kind === 'logcat' ? w.logcat : w.h264);

      it(`${kind}: closes 1008 for a host-less ticket on a udid two servers have`, async () => {
        const { a, b, findRows } = await lab();
        const w = wired(findRows);
        const hub = await serve(socketOf(w));
        const old = await tickets.mint(UDID, 'usr_1', { isAdmin: true });
        const viewer = new WebSocket(`${hub}/xenon/api/control/${UDID}/${kind}?ticket=${old}`);
        expect(await closeOf(viewer)).to.equal(1008);
        expect(w.started).to.deep.equal([]);
        expect(a.seen).to.deep.equal([]);
        expect(b.seen).to.deep.equal([]);
      });

      it(`${kind}: closes 1008 for a ticket whose host has no such phone`, async () => {
        const { a, b, findRows } = await lab();
        const w = wired(findRows);
        const hub = await serve(socketOf(w));
        const gone = await tickets.mint(UDID, 'usr_1', {}, 'http://elsewhere:4723');
        const viewer = new WebSocket(`${hub}/xenon/api/control/${UDID}/${kind}?ticket=${gone}`);
        expect(await closeOf(viewer)).to.equal(1008);
        expect(w.started).to.deep.equal([]);
        expect(a.seen).to.deep.equal([]);
        expect(b.seen).to.deep.equal([]);
      });

      it(`${kind}: a host-less ticket still reaches a udid only one server has`, async () => {
        const b = await fakeNode('b');
        const w = wired(async (udid) =>
          udid === UDID ? [{ udid: UDID, host: b.origin, nodeId: 'node-b', busy: false }] : [],
        );
        const hub = await serve(socketOf(w));
        const old = await tickets.mint(UDID, 'usr_1');
        const viewer = new WebSocket(`${hub}/xenon/api/control/${UDID}/${kind}?ticket=${old}`);
        expect(await firstMessage(viewer)).to.equal('from b');
        viewer.close();
      });
    }
  });
});
