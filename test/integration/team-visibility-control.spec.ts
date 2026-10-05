import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import cors from 'cors';
import request from '../helpers/loopbackRequest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import ControlRouter from '../../src/app/routers/control';
import { HIDDEN_DEVICE_UDID } from '../../src/middleware/controlDevice';
import { TeamService } from '../../src/services/TeamService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { XenonManager } from '../../src/device-managers';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { saveRegistrations } from '../helpers/container-registration';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { XenonDatabase } from '../../src/data-service/db';
import { useScratchDatabase } from '../helpers/scratch-database';
import { useLokiStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * Teams are a device boundary on /control, end to end: the real auth
 * middleware computes req.auth.teamIds from TeamMember rows, and the real
 * control router decides. A member gets a 404 on another team's phone, the
 * same 404 an unknown udid gets, and can use their own team's and shared
 * phones as before.
 */

/**
 * The control router picks a manager by constructor name. This one answers
 * the calls the visible-device cases make, so a 200 proves the request got
 * all the way through to the device.
 */
class IOSDeviceManager {
  async getScreenshot(): Promise<string> {
    return 'i'.repeat(200);
  }
  async tap(): Promise<void> {
    /* reached */
  }
}

/**
 * Every route the control router has, read from the router itself, so a route
 * added later is held to the same rule without anyone updating a list.
 */
function controlRoutes(): Array<{ method: string; action: string }> {
  const parent = express.Router();
  ControlRouter.register(parent);
  const mounted = (parent as any).stack.find((layer: any) => layer.handle?.stack);
  const routes: Array<{ method: string; action: string }> = [];
  for (const layer of mounted.handle.stack) {
    if (!layer.route) continue;
    const path: string = layer.route.path;
    // Every /control route addresses a device by its first segment. One that
    // doesn't would sit outside the team guard's reasoning, so fail loudly.
    if (!path.startsWith('/:udid/')) throw new Error(`control route without a udid: ${path}`);
    for (const method of Object.keys(layer.route.methods)) {
      if (method !== '_all') routes.push({ method, action: path.slice('/:udid/'.length) });
    }
  }
  return routes;
}

const CONTROL_ROUTES = controlRoutes();

/** The actions, each with the methods its routes accept. */
const METHODS_BY_ACTION = CONTROL_ROUTES.reduce((acc, { method, action }) => {
  acc.set(action, [...(acc.get(action) ?? []), method]);
  return acc;
}, new Map<string, string[]>());

describe('team boundary on /control (integration)', function () {
  this.timeout(60_000);

  // Hermetic, so it runs in `npm run test:all` and on its own alike: users,
  // teams and sessions go to a scratch database, never ~/.cache/xenon/xenon.db,
  // and the phones to the in-memory device store. Nothing here stubs `prisma`
  // itself, so the scratch database stands in for the whole suite.
  useScratchDatabase({ wholeSuite: true });
  useLokiStores();
  // The fixture phones are this server's own; see DEVICE_HOST.
  useOwnNodeId();

  let sa: SeededUser;
  let alice: SeededUser;
  let keyDir: string;
  let deviceRows: Awaited<typeof XenonDatabase.DeviceModel> | undefined;
  const restores: Array<() => void> = [];

  const stamp = Date.now();
  const SHARED_UDID = `tb-shared-${stamp}`;
  const TEAM_A_UDID = `tb-team-a-${stamp}`;
  const TEAM_B_UDID = `tb-team-b-${stamp}`;
  // Team B's phone on a node. /control sends a node's phone's actions on to
  // the node, or refuses them naming it (nodePhoneControl.ts), so the team
  // guard has to have hidden it before that gate runs.
  const TEAM_B_NODE_UDID = `tb-node-b-${stamp}`;
  // The same length as the hidden udids, so an answer that echoes the path
  // (Express's "Cannot GET …") has the same length for each.
  const UNKNOWN_UDID = `tb-nobody-${stamp}`;
  // Whose a phone is comes from its row: its nodeId, else its exact host
  // (isOtherServersPhone). A row with neither of this server's is another
  // server's phone, and /control sends its requests on to that host. So the
  // fixtures carry this server's node id, and /control runs them here with
  // the fake manager below. Port 1 has nothing listening, so a request sent
  // on by mistake fails at once instead of reaching a real server here.
  const DEVICE_HOST = 'http://127.0.0.1:1';

  before(async () => {
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-team-boundary-'));
    const keys = new JwtKeyService();
    await keys.init(keyDir);
    restores.push(saveRegistrations(JwtKeyService, XenonManager));
    Container.set(JwtKeyService, keys);
    Container.set(XenonManager, { deviceInstances: async () => [new IOSDeviceManager()] });

    // The scratch database goes with the suite, and every row seeded here
    // with it.
    sa = await seedUser('SUPER_ADMIN', { name: 'TB SA' });
    alice = await seedUser('MEMBER', { name: 'Alice (team A)' });
    const teamA = await Container.get(TeamService).create(`tb-team-a-${stamp}`);
    const teamB = await Container.get(TeamService).create(`tb-team-b-${stamp}`);
    await Container.get(TeamService).addMember(teamA.id, alice.user.id);

    // The in-memory store is one collection for the whole process. Held here,
    // so `after` removes these rows whatever useLokiStores has put back by then.
    deviceRows = await XenonDatabase.DeviceModel;
    const store = DeviceStoreFactory.getStore();
    for (const [udid, teamId, nodeId] of [
      [SHARED_UDID, null, OWN_NODE_ID],
      [TEAM_A_UDID, teamA.id, OWN_NODE_ID],
      [TEAM_B_UDID, teamB.id, OWN_NODE_ID],
      [TEAM_B_NODE_UDID, teamB.id, 'tb-another-node'],
    ] as Array<[string, string | null, string]>) {
      const row = await prisma.device.create({
        data: {
          udid,
          host: DEVICE_HOST,
          nodeId,
          name: udid,
          platform: 'ios',
          // Known screen size, so stream/ticket's after-response size fetch
          // has nothing to do once this suite has put the managers back.
          screenWidth: '1170',
          screenHeight: '2532',
          teamId,
        } as any,
      });
      await store.addDevices([row as any]);
    }
  });

  after(() => {
    deviceRows?.findAndRemove({
      udid: { $in: [SHARED_UDID, TEAM_A_UDID, TEAM_B_UDID, TEAM_B_NODE_UDID] },
    } as any);
    for (const restore of restores.reverse()) restore();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  /**
   * How a request no control route handled gets answered:
   * - `api`: the JSON 404 src/app/index.ts puts after every router;
   * - `express`: Express's own "Cannot GET …";
   * - `echo-url`: a later layer that answers with `req.url` itself, the
   *   careless kind the placeholder must not reach.
   */
  type Tail = 'api' | 'express' | 'echo-url';

  /**
   * The /xenon/api stack as src/app/index.ts builds it, as far as /control
   * goes: cors, auth, the control router, then `tail`.
   */
  function buildApp(tail: Tail = 'api') {
    const app = express();
    app.use(express.json());
    const apiRouter = express.Router();
    apiRouter.use(cors({ origin: false }));
    apiRouter.use(authMiddleware);
    ControlRouter.register(apiRouter);
    if (tail === 'api') {
      apiRouter.use('*', (req, res) => {
        res.status(404).json({
          error: true,
          message: `API endpoint ${req.method} ${req.originalUrl} not found`,
        });
      });
    }
    if (tail === 'echo-url') {
      apiRouter.use((req, res) => {
        res.status(404).json({ url: req.url, path: req.path });
      });
    }
    app.use('/xenon/api', apiRouter);
    return app;
  }

  function send(who: SeededUser, method: string, udid: string, action: string, tail: Tail = 'api') {
    const url = `/xenon/api/control/${encodeURIComponent(udid)}/${action}`;
    const req = (request(buildApp(tail)) as any)[method](url) as request.Test;
    return req.set('Cookie', who.cookie);
  }

  /** What a caller can observe of an answer, with the requested udid masked out. */
  function observed(res: request.Response, udid: string) {
    return {
      status: res.status,
      body: (res.text ?? '').split(udid).join('<udid>'),
      contentType: res.headers['content-type'],
      contentLength: res.headers['content-length'],
      allow: res.headers['allow'],
    };
  }

  async function expectSameAnswer(udid: string, method: string, action: string, tail: Tail) {
    const hidden = await send(alice, method, udid, action, tail);
    const unknown = await send(alice, method, UNKNOWN_UDID, action, tail);
    expect(observed(hidden, udid)).to.deep.equal(observed(unknown, UNKNOWN_UDID));
    // The guard's placeholder never reaches the caller, in a body or a header.
    expect(hidden.text ?? '', 'body').to.not.include(HIDDEN_DEVICE_UDID);
    expect(JSON.stringify(hidden.headers), 'headers').to.not.include(HIDDEN_DEVICE_UDID);
    return hidden;
  }

  const screenshot = (who: SeededUser, udid: string) => send(who, 'get', udid, 'screenshot');
  const tap = (who: SeededUser, udid: string) =>
    send(who, 'post', udid, 'tap').send({ x: 10, y: 20 });
  const ticket = (who: SeededUser, udid: string) => send(who, 'post', udid, 'stream/ticket');

  describe("a team-A member on team B's phone", () => {
    it('gets 404 on screenshot', async () => {
      const res = await screenshot(alice, TEAM_B_UDID);
      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'not_found', message: 'Device not found' });
    });

    it('gets 404 on tap', async () => {
      const res = await tap(alice, TEAM_B_UDID);
      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'not_found', message: 'Device not found' });
    });

    it('gets 404 on stream/ticket, and no ticket', async () => {
      const res = await ticket(alice, TEAM_B_UDID);
      expect(res.status).to.equal(404);
      expect(res.body.ticket).to.equal(undefined);
    });
  });

  for (const [label, udid] of [
    ["team A's phone", TEAM_A_UDID],
    ['a shared phone', SHARED_UDID],
  ]) {
    describe(`a team-A member on ${label}`, () => {
      it('gets 200 on screenshot', async () => {
        const res = await screenshot(alice, udid);
        expect(res.status, res.text).to.equal(200);
        expect(res.body.screenshot).to.be.a('string');
      });

      it('gets 200 on tap', async () => {
        const res = await tap(alice, udid);
        expect(res.status, res.text).to.equal(200);
        expect(res.body).to.deep.equal({ success: true });
      });

      it('gets 200 on stream/ticket, with a ticket', async () => {
        const res = await ticket(alice, udid);
        expect(res.status, res.text).to.equal(200);
        expect(res.body.ticket).to.be.a('string');
      });
    });
  }

  it("lets an admin use team B's phone", async () => {
    expect((await screenshot(sa, TEAM_B_UDID)).status).to.equal(200);
    expect((await tap(sa, TEAM_B_UDID)).status).to.equal(200);
    expect((await ticket(sa, TEAM_B_UDID)).status).to.equal(200);
  });

  // The guard swaps a hidden phone's udid for a placeholder in req.url, and
  // Express 4 doesn't put req.url back when a mounted router falls through.
  // register() restores it after the router, so a later layer sees the real
  // path, never the placeholder.
  it('gives a layer after the control router the real req.url back', async () => {
    const res = await send(alice, 'get', TEAM_B_UDID, 'bogus', 'echo-url');
    expect(res.body).to.deep.equal({
      url: `/control/${TEAM_B_UDID}/bogus`,
      path: `/control/${TEAM_B_UDID}/bogus`,
    });
  });

  it('reads every control route from the router', () => {
    expect(CONTROL_ROUTES.length).to.be.at.least(28);
    expect(CONTROL_ROUTES).to.deep.include({ method: 'post', action: 'tap' });
    expect(CONTROL_ROUTES).to.deep.include({ method: 'get', action: 'inspector/snapshot' });
  });

  // The point of answering 404 is that nothing tells a member another team
  // has this phone. Hold every request to that: another team's phone has to
  // get the same status, body, content type, length and Allow header as a
  // udid that does not exist, whether a route handles the request or not.
  // On this server or on a node: a node's phone must not get the gate's
  // forward or its refusal naming the node.
  for (const [label, hiddenUdid] of [
    ["another team's phone", TEAM_B_UDID],
    ["another team's phone on a node", TEAM_B_NODE_UDID],
  ]) {
    describe(`${label} answers exactly like an unknown udid`, () => {
      describe('on every route', () => {
        for (const { method, action } of CONTROL_ROUTES) {
          it(`${method.toUpperCase()} ${action}`, async () => {
            const res = await expectSameAnswer(hiddenUdid, method, action, 'api');
            expect(res.status, 'status').to.equal(404);
          });
        }
      });

      const TAIL_LABEL: Record<Tail, string> = {
        api: "the API's JSON 404",
        express: "Express's own 404",
        'echo-url': 'a later layer that echoes req.url',
      };
      for (const tail of ['api', 'express', 'echo-url'] as const) {
        describe(`where no route handles the request (${TAIL_LABEL[tail]})`, () => {
          for (const [method, action] of [
            ['get', 'bogus'],
            ['post', 'bogus'],
            ['post', 'stream/bogus'],
            ['get', ''],
          ]) {
            it(`${method.toUpperCase()} ${action || '(no action)'}`, async () => {
              await expectSameAnswer(hiddenUdid, method, action, tail);
            });
          }

          for (const [action, methods] of METHODS_BY_ACTION) {
            const wrong = methods.includes('get') ? 'post' : 'get';
            if (methods.includes(wrong)) continue;
            it(`${wrong.toUpperCase()} ${action} (the wrong method)`, async () => {
              await expectSameAnswer(hiddenUdid, wrong, action, tail);
            });
          }
        });
      }

      describe('OPTIONS', () => {
        for (const [action, methods] of METHODS_BY_ACTION) {
          it(`OPTIONS ${action}`, async () => {
            const res = await expectSameAnswer(hiddenUdid, 'options', action, 'api');
            expect(res.headers['allow'], 'allow').to.be.a('string');
            for (const m of methods) expect(res.headers['allow']).to.include(m.toUpperCase());
          });
        }
      });
    });
  }
});
