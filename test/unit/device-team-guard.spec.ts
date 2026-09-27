import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { deviceTeamGuard, DeviceTeamGuardDeps } from '../../src/middleware/deviceTeamGuard';
import { isDeviceVisible } from '../../src/services/device-access/deviceVisibility';

/**
 * Teams are a device boundary. A member may use a phone in the shared pool or
 * on one of their teams; any other phone answers exactly like one that does
 * not exist. See docs/superpowers/specs/2026-09-27-team-device-boundary-design.md.
 */

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

const SHARED = 'DEV-SHARED';
const PHONE_A = 'DEV-A';
const PHONE_B = 'DEV-B';
const UNKNOWN = 'DEV-UNKNOWN';

const DEVICES: Record<string, { teamId: string | null }> = {
  [SHARED]: { teamId: null },
  [PHONE_A]: { teamId: TEAM_A },
  [PHONE_B]: { teamId: TEAM_B },
};

type Caller = { role: string; scopes: string; teamIds?: string[] };

const ALICE: Caller = { role: 'MEMBER', scopes: 'devices,sessions,read', teamIds: [TEAM_A] };
const NO_TEAM: Caller = { role: 'MEMBER', scopes: 'devices,sessions,read', teamIds: [] };
const ADMIN: Caller = { role: 'ADMIN', scopes: 'admin,devices,sessions,read' };

/** Every method the spec names: a GET read, a mutation, and the four stream actions. */
const ACTIONS: Array<{ method: 'get' | 'post'; action: string }> = [
  { method: 'get', action: 'screenshot' },
  { method: 'post', action: 'tap' },
  { method: 'post', action: 'stream/start' },
  { method: 'post', action: 'stream/ticket' },
  { method: 'post', action: 'stream/stop' },
  { method: 'post', action: 'stream/leave' },
];

// Mini router shaped like /control: a udid segment then an action segment.
function appWith(
  caller: Caller | null,
  findDevice: DeviceTeamGuardDeps['findDevice'] = async (udid) => DEVICES[udid] ?? null,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (caller) {
      (req as any).auth = {
        kind: 'user-session',
        userId: 'usr_caller',
        role: caller.role,
        scopes: caller.scopes,
        rateLimit: 100,
        teamIds: caller.teamIds,
      };
    }
    next();
  });
  const router = express.Router();
  router.use(deviceTeamGuard({ findDevice }));
  const reached = (_req: express.Request, res: express.Response) => res.json({ reached: true });
  for (const { method, action } of ACTIONS) router[method](`/:udid/${action}`, reached);
  router.get('/:udid/display', reached);
  router.get('/:udid/appium-session', reached);
  app.use('/control', router);
  return app;
}

function call(app: express.Express, method: 'get' | 'post', path: string) {
  return method === 'get' ? request(app).get(path) : request(app).post(path);
}

describe('isDeviceVisible', () => {
  it('shows every device to an unscoped caller (admin, auth disabled)', () => {
    expect(isDeviceVisible(null, undefined)).to.equal(true);
    expect(isDeviceVisible(TEAM_A, undefined)).to.equal(true);
    expect(isDeviceVisible(TEAM_B, undefined)).to.equal(true);
  });

  it('shows a member in no team only the shared pool', () => {
    expect(isDeviceVisible(null, [])).to.equal(true);
    expect(isDeviceVisible(undefined, [])).to.equal(true);
    expect(isDeviceVisible(TEAM_A, [])).to.equal(false);
  });

  it('shows a member the shared pool and their own teams, nothing else', () => {
    expect(isDeviceVisible(null, [TEAM_A])).to.equal(true);
    expect(isDeviceVisible(TEAM_A, [TEAM_A])).to.equal(true);
    expect(isDeviceVisible(TEAM_B, [TEAM_A])).to.equal(false);
    expect(isDeviceVisible(TEAM_B, [TEAM_A, TEAM_B])).to.equal(true);
  });
});

describe('deviceTeamGuard', () => {
  for (const { method, action } of ACTIONS) {
    describe(`${method.toUpperCase()} ${action}`, () => {
      it("answers 404 'Device not found' for another team's phone, without reaching the handler", async () => {
        const res = await call(appWith(ALICE), method, `/control/${PHONE_B}/${action}`);
        expect(res.status).to.equal(404);
        expect(res.text).to.equal('Device not found');
        expect(res.body.reached).to.equal(undefined);
      });

      it('lets a member through to their own team’s phone', async () => {
        const res = await call(appWith(ALICE), method, `/control/${PHONE_A}/${action}`);
        expect(res.status, res.text).to.equal(200);
        expect(res.body.reached).to.equal(true);
      });

      it('lets a member through to a shared phone', async () => {
        const res = await call(appWith(ALICE), method, `/control/${SHARED}/${action}`);
        expect(res.status, res.text).to.equal(200);
        expect(res.body.reached).to.equal(true);
      });

      it('lets an admin through to any team’s phone', async () => {
        const res = await call(appWith(ADMIN), method, `/control/${PHONE_B}/${action}`);
        expect(res.status, res.text).to.equal(200);
        expect(res.body.reached).to.equal(true);
      });
    });
  }

  it('gives a member in no team the shared pool only', async () => {
    const app = appWith(NO_TEAM);
    expect((await request(app).get(`/control/${SHARED}/screenshot`)).status).to.equal(200);
    const a = await request(app).get(`/control/${PHONE_A}/screenshot`);
    expect(a.status).to.equal(404);
    expect(a.text).to.equal('Device not found');
  });

  // The handlers for these two answer an unknown udid with JSON, not the
  // plain-text default. A hidden phone has to give the same body, or the
  // difference tells a member that another team owns that udid.
  for (const action of ['display', 'appium-session']) {
    it(`answers ${action} with that handler's own JSON 404 body`, async () => {
      const res = await request(appWith(ALICE)).get(`/control/${PHONE_B}/${action}`);
      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({ status: 'error', message: 'Device not found' });
    });
  }

  it('guards an action in any letter case', async () => {
    const res = await request(appWith(ALICE)).post(`/control/${PHONE_B}/Stream/Start`);
    expect(res.status).to.equal(404);
    expect(res.body.reached).to.equal(undefined);
  });

  // Admin means req.auth.teamIds === undefined and nothing else. Listings key
  // on teamIds; a guard that also honoured an `admin` scope would let a caller
  // drive a phone the device list hides from them.
  it('ignores an admin scope on a caller whose teams are scoped', async () => {
    const scoped: Caller = { role: 'MEMBER', scopes: 'admin,devices', teamIds: [TEAM_A] };
    const res = await request(appWith(scoped)).post(`/control/${PHONE_B}/tap`);
    expect(res.status).to.equal(404);
  });

  it('does not look the device up for an admin', async () => {
    let lookups = 0;
    const app = appWith(ADMIN, async (udid) => {
      lookups += 1;
      return DEVICES[udid] ?? null;
    });
    const res = await request(app).get(`/control/${PHONE_B}/screenshot`);
    expect(res.status).to.equal(200);
    expect(lookups).to.equal(0);
  });

  it('falls through to the handler for an unknown device', async () => {
    const res = await request(appWith(ALICE)).post(`/control/${UNKNOWN}/tap`);
    expect(res.status).to.equal(200);
    expect(res.body.reached).to.equal(true);
  });

  it('fails closed with 503 when the device lookup throws', async () => {
    const res = await request(
      appWith(ALICE, async () => {
        throw new Error('store hiccup');
      }),
    ).get(`/control/${PHONE_A}/screenshot`);
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({
      success: false,
      error: 'device_ownership_unavailable',
      message: 'Could not verify device ownership. Try again.',
    });
    expect(res.body.reached).to.equal(undefined);
  });

  it('answers 400 for a udid segment that cannot be decoded', async function () {
    // An async middleware that throws never answers under Express 4, so keep
    // a short timeout: a regression should fail fast, not after 60s.
    this.timeout(5000);
    const res = await request(appWith(ALICE)).get('/control/100%/screenshot');
    expect(res.status).to.equal(400);
    expect(res.body).to.deep.equal({ success: false, error: 'invalid_udid' });
  });

  it('401s when there is no caller', async () => {
    const res = await request(appWith(null)).get(`/control/${PHONE_A}/screenshot`);
    expect(res.status).to.equal(401);
  });
});
