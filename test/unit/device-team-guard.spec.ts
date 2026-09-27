import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import {
  deviceTeamGuard,
  DeviceTeamGuardDeps,
  restoreHiddenDeviceUrl,
} from '../../src/middleware/deviceTeamGuard';
import { HIDDEN_DEVICE_UDID } from '../../src/middleware/controlDevice';
import { isDeviceVisible } from '../../src/services/device-access/deviceVisibility';

/**
 * Teams are a device boundary. A member may use a phone in the shared pool or
 * on one of their teams; any other phone answers exactly like one that does
 * not exist. See docs/superpowers/specs/2026-09-27-team-device-boundary-design.md.
 *
 * The guard doesn't answer a hidden phone itself. It swaps the udid for one
 * no device has and lets the request go on, so every later layer (the
 * handler's 404, Express's own 404 and OPTIONS answers) gives exactly its
 * unknown-udid answer.
 */

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

// PHONE_B and UNKNOWN are the same length, so an answer that echoes the path
// is the same length for both.
const SHARED = 'DEV-SHARED';
const PHONE_A = 'DEV-A';
const PHONE_B = 'DEV-B';
const UNKNOWN = 'DEV-X';

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

/**
 * A mini router shaped like /control: a udid segment, then an action. Each
 * handler looks the device up and answers an unknown one the way control.ts
 * does, and records the udid it was given.
 */
function appWith(
  caller: Caller | null,
  findDevice: DeviceTeamGuardDeps['findDevice'] = async (udid) => DEVICES[udid] ?? null,
) {
  const seen: string[] = [];
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
  const handler =
    (notFound: unknown = 'Device not found') =>
    (req: express.Request, res: express.Response) => {
      seen.push(req.params.udid);
      if (!DEVICES[req.params.udid]) return res.status(404).send(notFound);
      return res.json({ reached: true, originalUrl: req.originalUrl });
    };
  for (const { method, action } of ACTIONS) router[method](`/:udid/${action}`, handler());
  const jsonNotFound = { status: 'error', message: 'Device not found' };
  router.get('/:udid/display', handler(jsonNotFound));
  router.get('/:udid/appium-session', handler(jsonNotFound));
  app.use('/control', router);
  return { app, seen };
}

function call(app: express.Express, method: string, path: string) {
  return (request(app) as any)[method](path) as request.Test;
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
      it("answers another team's phone with the unknown-device 404, and the handler never sees its udid", async () => {
        const { app, seen } = appWith(ALICE);
        const res = await call(app, method, `/control/${PHONE_B}/${action}`);
        expect(res.status).to.equal(404);
        expect(res.text).to.equal('Device not found');
        expect(seen).to.not.include(PHONE_B);
      });

      it('lets a member through to their own team’s phone', async () => {
        const res = await call(appWith(ALICE).app, method, `/control/${PHONE_A}/${action}`);
        expect(res.status, res.text).to.equal(200);
        expect(res.body.reached).to.equal(true);
      });

      it('lets a member through to a shared phone', async () => {
        const res = await call(appWith(ALICE).app, method, `/control/${SHARED}/${action}`);
        expect(res.status, res.text).to.equal(200);
        expect(res.body.reached).to.equal(true);
      });

      it('lets an admin through to any team’s phone', async () => {
        const res = await call(appWith(ADMIN).app, method, `/control/${PHONE_B}/${action}`);
        expect(res.status, res.text).to.equal(200);
        expect(res.body.reached).to.equal(true);
      });
    });
  }

  it('hands a hidden phone on as a udid no device has, keeping the original URL', async () => {
    const { app, seen } = appWith(ALICE);
    await request(app).get(`/control/${PHONE_B}/screenshot?x=1`);
    expect(seen).to.deep.equal([HIDDEN_DEVICE_UDID]);
    expect(DEVICES[HIDDEN_DEVICE_UDID]).to.equal(undefined);
  });

  it('keeps req.originalUrl, so an answer that echoes the path echoes the real one', async () => {
    let originalUrl = '';
    const app = express();
    app.use((req, _res, next) => {
      (req as any).auth = { userId: 'usr_caller', teamIds: [TEAM_A] };
      next();
    });
    const router = express.Router();
    router.use(deviceTeamGuard({ findDevice: async (u) => DEVICES[u] ?? null }));
    router.use((req, res) => {
      originalUrl = req.originalUrl;
      res.end();
    });
    app.use('/control', router);
    await request(app).get(`/control/${PHONE_B}/screenshot?x=1`);
    expect(originalUrl).to.equal(`/control/${PHONE_B}/screenshot?x=1`);
  });

  describe('restoreHiddenDeviceUrl, mounted after the router at the parent', () => {
    // As control.ts's register() mounts it: after the router, at the parent,
    // so it runs only once the router has fallen through and can never come
    // before a route.
    function parentApp(caller: Caller) {
      const seenByRoute: string[] = [];
      const app = express();
      app.use((req, _res, next) => {
        (req as any).auth = { userId: 'usr_caller', teamIds: caller.teamIds };
        next();
      });
      const router = express.Router();
      router.use(deviceTeamGuard({ findDevice: async (u) => DEVICES[u] ?? null }));
      router.get('/:udid/screenshot', (req, res) => {
        seenByRoute.push(req.params.udid);
        res.status(404).send('Device not found');
      });
      app.use('/control', router, restoreHiddenDeviceUrl);
      app.use((req, res) => res.status(404).json({ url: req.url, path: req.path }));
      return { app, seenByRoute };
    }

    it('gives a later layer the real req.url after the router falls through', async () => {
      const res = await request(parentApp(ALICE).app).get(`/control/${PHONE_B}/bogus?x=1`);
      expect(res.body).to.deep.equal({
        url: `/control/${PHONE_B}/bogus?x=1`,
        path: `/control/${PHONE_B}/bogus`,
      });
    });

    it('answers a hidden phone and an unknown udid alike, even where a layer echoes req.url', async () => {
      const { app } = parentApp(ALICE);
      const hidden = await request(app).get(`/control/${PHONE_B}/bogus`);
      const unknown = await request(app).get(`/control/${UNKNOWN}/bogus`);
      expect(observed(hidden, PHONE_B)).to.deep.equal(observed(unknown, UNKNOWN));
      expect(hidden.text).to.not.include(HIDDEN_DEVICE_UDID);
    });

    it('still hands a routed request the placeholder, not the real udid', async () => {
      const { app, seenByRoute } = parentApp(ALICE);
      const res = await request(app).get(`/control/${PHONE_B}/screenshot`);
      expect(res.text).to.equal('Device not found');
      expect(seenByRoute).to.deep.equal([HIDDEN_DEVICE_UDID]);
    });

    it('leaves a request it did not rewrite alone', async () => {
      const res = await request(parentApp(ALICE).app).get(`/control/${PHONE_A}/bogus`);
      expect(res.body.url).to.equal(`/control/${PHONE_A}/bogus`);
    });
  });

  it('gives a member in no team the shared pool only', async () => {
    const { app } = appWith(NO_TEAM);
    expect((await request(app).get(`/control/${SHARED}/screenshot`)).status).to.equal(200);
    const a = await request(app).get(`/control/${PHONE_A}/screenshot`);
    expect(a.status).to.equal(404);
    expect(a.text).to.equal('Device not found');
  });

  // The handlers for these two answer an unknown udid with JSON, not the
  // plain-text default. A hidden phone gets the same body, from the handler.
  for (const action of ['display', 'appium-session']) {
    it(`answers ${action} with that handler's own JSON 404 body`, async () => {
      const res = await request(appWith(ALICE).app).get(`/control/${PHONE_B}/${action}`);
      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({ status: 'error', message: 'Device not found' });
    });
  }

  it('guards an action in any letter case', async () => {
    const { app, seen } = appWith(ALICE);
    const start = await request(app).post(`/control/${PHONE_B}/Stream/Start`);
    expect(start.status).to.equal(404);
    const display = await request(app).get(`/control/${PHONE_B}/Display`);
    expect(display.status).to.equal(404);
    expect(display.body).to.deep.equal({ status: 'error', message: 'Device not found' });
    expect(seen).to.not.include(PHONE_B);
  });

  // Requests no route handles are where a guard that answered for itself
  // would differ: Express, not a handler, answers an unknown udid there.
  describe('answers a hidden phone exactly like an unknown udid where no route handles the request', () => {
    const CASES: Array<[string, string, string]> = [
      ['an action no route has', 'get', 'bogus'],
      ['a POST to an action no route has', 'post', 'stream/bogus'],
      ['the wrong method on a real action', 'get', 'tap'],
      ['OPTIONS on a real action', 'options', 'screenshot'],
      ['no action at all', 'get', ''],
    ];
    for (const [label, method, action] of CASES) {
      it(label, async () => {
        const { app, seen } = appWith(ALICE);
        const hidden = await call(app, method, `/control/${PHONE_B}/${action}`);
        const unknown = await call(app, method, `/control/${UNKNOWN}/${action}`);
        expect(observed(hidden, PHONE_B)).to.deep.equal(observed(unknown, UNKNOWN));
        expect(hidden.text ?? '').to.not.include(HIDDEN_DEVICE_UDID);
        expect(seen).to.not.include(PHONE_B);
      });
    }
  });

  // Admin means req.auth.teamIds === undefined and nothing else. Listings key
  // on teamIds; a guard that also honoured an `admin` scope would let a caller
  // drive a phone the device list hides from them.
  it('ignores an admin scope on a caller whose teams are scoped', async () => {
    const scoped: Caller = { role: 'MEMBER', scopes: 'admin,devices', teamIds: [TEAM_A] };
    const res = await request(appWith(scoped).app).post(`/control/${PHONE_B}/tap`);
    expect(res.status).to.equal(404);
  });

  it('does not look the device up for an admin', async () => {
    let lookups = 0;
    const { app } = appWith(ADMIN, async (udid) => {
      lookups += 1;
      return DEVICES[udid] ?? null;
    });
    const res = await request(app).get(`/control/${PHONE_B}/screenshot`);
    expect(res.status).to.equal(200);
    expect(lookups).to.equal(0);
  });

  it('passes an unknown device on untouched, for the handler to answer', async () => {
    const { app, seen } = appWith(ALICE);
    const res = await request(app).post(`/control/${UNKNOWN}/tap`);
    expect(res.status).to.equal(404);
    expect(seen).to.deep.equal([UNKNOWN]);
  });

  it('fails closed with 503 when the device lookup throws', async () => {
    const { app, seen } = appWith(ALICE, async () => {
      throw new Error('store hiccup');
    });
    const res = await request(app).get(`/control/${PHONE_A}/screenshot`);
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({
      success: false,
      error: 'device_ownership_unavailable',
      message: 'Could not verify device ownership. Try again.',
    });
    expect(seen).to.deep.equal([]);
  });

  it('answers 400 for a udid segment that cannot be decoded', async function () {
    // An async middleware that throws never answers under Express 4, so keep
    // a short timeout: a regression should fail fast, not after 60s.
    this.timeout(5000);
    const res = await request(appWith(ALICE).app).get('/control/100%/screenshot');
    expect(res.status).to.equal(400);
    expect(res.body).to.deep.equal({ success: false, error: 'invalid_udid' });
  });

  it('401s when there is no caller', async () => {
    const res = await request(appWith(null).app).get(`/control/${PHONE_A}/screenshot`);
    expect(res.status).to.equal(401);
  });
});
