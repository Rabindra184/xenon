import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { deviceAccessGuard } from '../../src/middleware/deviceAccessGuard';

const UDID = 'DEV-1';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

// Mini router shaped like /control: a udid segment then an action segment.
function appWith(opts: {
  actorUserId?: string;
  role?: string;
  scopes?: string;
  busy?: boolean;
  sessionId?: string | null;
  sessionOwner?: string | null;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (opts.actorUserId) {
      (req as any).auth = {
        kind: 'api-key',
        userId: opts.actorUserId,
        role: opts.role ?? 'MEMBER',
        scopes: opts.scopes ?? 'devices',
        rateLimit: 100,
      };
    }
    next();
  });
  const router = express.Router();
  router.use(
    deviceAccessGuard({
      findDevice: async () => ({
        busy: opts.busy ?? true,
        session_id: opts.sessionId === undefined ? `manual_${ALICE}_${UDID}` : opts.sessionId,
      }),
      resolveSessionOwner: async () => opts.sessionOwner ?? null,
      describeHolder: async (id: string) => (id === ALICE ? 'alice@example.com' : null),
    }),
  );
  router.post('/:udid/tap', (_req, res) => res.json({ success: true, reached: true }));
  router.get('/:udid/screenshot', (_req, res) => res.json({ reached: true }));
  router.post('/:udid/stream/start', (_req, res) => res.json({ reached: true }));
  router.post('/:udid/stream/stop', (_req, res) => res.json({ reached: true }));
  router.post('/:udid/stream/ticket', (_req, res) => res.json({ reached: true }));
  app.use('/control', router);
  return app;
}

describe('deviceAccessGuard', () => {
  it('lets the lock owner through', async () => {
    const res = await request(appWith({ actorUserId: ALICE })).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(200);
    expect(res.body.reached).to.equal(true);
  });

  it('denies a foreign holder with 409 and names them', async () => {
    const res = await request(appWith({ actorUserId: BOB })).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(409);
    expect(res.body.error).to.equal('device_held_by_another_user');
    expect(res.body.message).to.contain('alice@example.com');
    expect(res.body.holder).to.deep.equal({ userId: ALICE, name: 'alice@example.com' });
  });

  it('never blocks a GET', async () => {
    const res = await request(appWith({ actorUserId: BOB })).get(`/control/${UDID}/screenshot`);
    expect(res.status).to.equal(200);
  });

  it('skips stream/start, stream/stop and stream/ticket', async () => {
    const app = appWith({ actorUserId: BOB });
    for (const p of ['stream/start', 'stream/stop', 'stream/ticket']) {
      const res = await request(app).post(`/control/${UDID}/${p}`);
      expect(res.status, p).to.equal(200);
    }
  });

  it('lets an admin-scoped key through', async () => {
    const res = await request(appWith({ actorUserId: BOB, scopes: 'admin' })).post(
      `/control/${UDID}/tap`,
    );
    expect(res.status).to.equal(200);
  });

  it('lets a SUPER_ADMIN through', async () => {
    const res = await request(appWith({ actorUserId: BOB, role: 'SUPER_ADMIN' })).post(
      `/control/${UDID}/tap`,
    );
    expect(res.status).to.equal(200);
  });

  it('does not treat a scope merely containing "admin" as admin', async () => {
    const res = await request(appWith({ actorUserId: BOB, scopes: 'nonadmin,devices' })).post(
      `/control/${UDID}/tap`,
    );
    expect(res.status).to.equal(409);
  });

  it('401s when there is no actor', async () => {
    const res = await request(appWith({})).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(401);
  });

  it('denies a foreign Appium session', async () => {
    const res = await request(
      appWith({ actorUserId: BOB, sessionId: 'appium-1', sessionOwner: ALICE }),
    ).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(409);
    expect(res.body.error).to.equal('device_in_use_by_session');
  });

  it('allows the owner of the running Appium session', async () => {
    const res = await request(
      appWith({ actorUserId: ALICE, sessionId: 'appium-1', sessionOwner: ALICE }),
    ).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(200);
  });

  it('falls through to the handler when the device is unknown', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'api-key',
        userId: BOB,
        role: 'MEMBER',
        scopes: 'devices',
        rateLimit: 1,
      };
      next();
    });
    const router = express.Router();
    router.use(deviceAccessGuard({ findDevice: async () => null }));
    router.post('/:udid/tap', (_req, res) => res.status(404).send('Device not found'));
    app.use('/control', router);
    const res = await request(app).post(`/control/${UDID}/tap`);
    expect(res.status).to.equal(404);
  });
});
