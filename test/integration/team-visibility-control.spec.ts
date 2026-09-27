import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import ControlRouter from '../../src/app/routers/control';
import { TeamService } from '../../src/services/TeamService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { XenonManager } from '../../src/device-managers';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

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

/** Every route in src/app/routers/control.ts. */
const CONTROL_ROUTES: Array<{ method: 'get' | 'post'; action: string }> = [
  { method: 'post', action: 'tap' },
  { method: 'post', action: 'swipe' },
  { method: 'post', action: 'text' },
  { method: 'post', action: 'keyevent' },
  { method: 'get', action: 'screenshot' },
  { method: 'get', action: 'clipboard' },
  { method: 'post', action: 'clipboard' },
  { method: 'post', action: 'touchAndHold' },
  { method: 'post', action: 'lock' },
  { method: 'post', action: 'unlock' },
  { method: 'get', action: 'display' },
  { method: 'post', action: 'install' },
  { method: 'post', action: 'install-repository-app' },
  { method: 'post', action: 'upload-install' },
  { method: 'post', action: 'uninstall' },
  { method: 'get', action: 'apps' },
  { method: 'get', action: 'logs' },
  { method: 'post', action: 'stream/start' },
  { method: 'post', action: 'stream/ticket' },
  { method: 'post', action: 'stream/leave' },
  { method: 'post', action: 'stream/stop' },
  { method: 'get', action: 'stream/status' },
  { method: 'get', action: 'stream' },
  { method: 'post', action: 'shell' },
  { method: 'get', action: 'omni-scan' },
  { method: 'get', action: 'inspector/snapshot' },
  { method: 'get', action: 'appium-session' },
  { method: 'post', action: 'test-locator' },
];

/** Register `value` under `id` for this suite; returns what puts the old one back. */
function swapService(id: any, value: unknown): () => void {
  const had = Container.has(id);
  const previous = had ? Container.get(id) : undefined;
  Container.set(id, value);
  return () => {
    if (had) Container.set(id, previous);
    else Container.remove(id);
  };
}

describe('team boundary on /control (integration)', function () {
  this.timeout(60_000);

  let sa: SeededUser;
  let alice: SeededUser;
  let teamA: { id: string };
  let teamB: { id: string };
  let keyDir: string;
  const restores: Array<() => void> = [];

  const stamp = Date.now();
  const SHARED_UDID = `tb-shared-${stamp}`;
  const TEAM_A_UDID = `tb-team-a-${stamp}`;
  const TEAM_B_UDID = `tb-team-b-${stamp}`;
  const UNKNOWN_UDID = `tb-unknown-${stamp}`;
  // The tap handler proxies to the device's host unless it is this server, so
  // every device lives "here" and each request says it is addressed here.
  const DEVICE_HOST = 'http://127.0.0.1:4723';
  const HOST_HEADER = '127.0.0.1:4723';

  before(async () => {
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-team-boundary-'));
    const keys = new JwtKeyService();
    await keys.init(keyDir);
    restores.push(swapService(JwtKeyService, keys));
    restores.push(
      swapService(XenonManager, { deviceInstances: async () => [new IOSDeviceManager()] }),
    );

    sa = await seedUser('SUPER_ADMIN', { name: 'TB SA' });
    alice = await seedUser('MEMBER', { name: 'Alice (team A)' });
    teamA = await Container.get(TeamService).create(`tb-team-a-${stamp}`);
    teamB = await Container.get(TeamService).create(`tb-team-b-${stamp}`);
    await Container.get(TeamService).addMember(teamA.id, alice.user.id);

    const store = DeviceStoreFactory.getStore();
    for (const [udid, teamId] of [
      [SHARED_UDID, null],
      [TEAM_A_UDID, teamA.id],
      [TEAM_B_UDID, teamB.id],
    ] as Array<[string, string | null]>) {
      const row = await prisma.device.create({
        data: {
          udid,
          host: DEVICE_HOST,
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

  after(async () => {
    await prisma.device.deleteMany({
      where: { udid: { in: [SHARED_UDID, TEAM_A_UDID, TEAM_B_UDID] } },
    });
    await prisma.teamMember.deleteMany({ where: { teamId: { in: [teamA.id, teamB.id] } } });
    await prisma.team.delete({ where: { id: teamA.id } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: teamB.id } }).catch(() => undefined);
    await sa.cleanup();
    await alice.cleanup();
    for (const restore of restores.reverse()) restore();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    const apiRouter = express.Router();
    apiRouter.use(authMiddleware);
    ControlRouter.register(apiRouter);
    app.use('/xenon/api', apiRouter);
    return app;
  }

  function send(who: SeededUser, method: 'get' | 'post', udid: string, action: string) {
    const url = `/xenon/api/control/${encodeURIComponent(udid)}/${action}`;
    const req = method === 'get' ? request(buildApp()).get(url) : request(buildApp()).post(url);
    return req.set('Cookie', who.cookie).set('Host', HOST_HEADER);
  }

  const screenshot = (who: SeededUser, udid: string) => send(who, 'get', udid, 'screenshot');
  const tap = (who: SeededUser, udid: string) =>
    send(who, 'post', udid, 'tap').send({ x: 10, y: 20 });
  const ticket = (who: SeededUser, udid: string) => send(who, 'post', udid, 'stream/ticket');

  describe("a team-A member on team B's phone", () => {
    it('gets 404 on screenshot', async () => {
      const res = await screenshot(alice, TEAM_B_UDID);
      expect(res.status).to.equal(404);
      expect(res.text).to.equal('Device not found');
    });

    it('gets 404 on tap', async () => {
      const res = await tap(alice, TEAM_B_UDID);
      expect(res.status).to.equal(404);
      expect(res.text).to.equal('Device not found');
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

  // The point of answering 404 is that nothing tells a member another team
  // has this phone. Hold every route to that: another team's phone has to get
  // the same status, content type and body as a udid that does not exist.
  describe("another team's phone answers exactly like an unknown udid", () => {
    for (const { method, action } of CONTROL_ROUTES) {
      it(`${method.toUpperCase()} ${action}`, async () => {
        const hidden = await send(alice, method, TEAM_B_UDID, action);
        const unknown = await send(alice, method, UNKNOWN_UDID, action);
        expect(hidden.status, 'status').to.equal(404);
        expect(hidden.status, 'status').to.equal(unknown.status);
        expect(hidden.headers['content-type'], 'content-type').to.equal(
          unknown.headers['content-type'],
        );
        expect(hidden.text, 'body').to.equal(unknown.text);
      });
    }
  });
});
