import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import GridRouter from '../../src/app/routers/grid';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { QueueService } from '../../src/data-service/queue-service';
import { prisma } from '../../src/prisma';

/**
 * The session queue follows teams: "own teams + a count".
 *
 * A member sees a waiting request in detail when it names (`appium:udid`) a
 * phone they can see, or when they made it or it came from their team. The
 * rest they get only as a number. Admins see everything.
 *
 * Until this, a request that named no phone went to every member, with its
 * capabilities, build name and requester.
 */

const REQUESTER = 'xenon:requester';

const DEVICES = [
  { udid: 'phone-a', teamId: 'team-a' },
  { udid: 'phone-b', teamId: 'team-b' },
];

const MEMBERSHIPS = [
  { userId: 'alice', teamId: 'team-a' }, // the member asking
  { userId: 'amy', teamId: 'team-a' }, // her teammate
  { userId: 'bob', teamId: 'team-b' },
  { userId: 'carol', teamId: 'team-c' },
];

const row = (id: string, at: number, extra: Record<string, unknown>) => ({
  capability_id: id,
  createdAt: at,
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  ...extra,
});

// The four kinds of waiting request, in the order they were queued.
const ROWS = [
  // Targets a team-A phone. From someone in neither team, so only the phone
  // makes it Alice's to see.
  row('targets-a', 1, {
    'appium:udid': 'phone-a',
    'xenon:build': 'carol-nightly',
    [REQUESTER]: { userId: 'carol', teamId: null },
  }),
  row('targets-b', 2, {
    'appium:udid': 'phone-b',
    'xenon:build': 'bob-targeted',
    [REQUESTER]: { userId: 'bob', teamId: null },
  }),
  // Untargeted, from Alice's teammate, who signed it in two ways.
  row('untargeted-a', 3, {
    'xenon:build': 'amy-smoke',
    'df:options': { accessKey: 'ak_amy', token: 'amy-api-token' },
    'xenon:options': { sessionToken: 'amy.session.jwt', sessionName: 'amy-login' },
    [REQUESTER]: { userId: 'amy', teamId: null },
  }),
  // Untargeted, from team B: the leak. Every member used to get this one.
  row('untargeted-b', 4, {
    'xenon:build': 'bob-secret-release',
    [REQUESTER]: { userId: 'bob', teamId: null },
  }),
];

function app(caller: { userId: string; role: 'MEMBER' | 'ADMIN'; teamIds?: string[] }) {
  const a = express();
  a.use((req: any, _res, next) => {
    req.auth = {
      kind: 'user-session',
      userId: caller.userId,
      role: caller.role,
      scopes: scopesForRole(caller.role),
      teamIds: caller.teamIds,
    };
    next();
  });
  GridRouter.register(a as any, { bindHostOrIp: '127.0.0.1' } as any);
  return a;
}

const alice = () => app({ userId: 'alice', role: 'MEMBER', teamIds: ['team-a'] });
const admin = () => app({ userId: 'root', role: 'ADMIN', teamIds: undefined });

const ids = (rows: Array<{ capability_id: string }>) => rows.map((r) => r.capability_id);

describe('the session queue is team-scoped: own teams + a count', () => {
  beforeEach(() => {
    // The grid router and QueueService each hold the pending store they were
    // built with, and a test-container reset replaces the factory's instance;
    // every instance shares the class, so stub it there.
    const pendingProto = Object.getPrototypeOf(DeviceStoreFactory.getPendingSessionStore());
    // Fresh copies per read, as the store hands out.
    sinon
      .stub(pendingProto, 'getAllPendingSessions')
      .callsFake(async () => JSON.parse(JSON.stringify(ROWS)));
    const deviceProto = Object.getPrototypeOf(DeviceStoreFactory.getStore());
    sinon.stub(deviceProto, 'getAllDevices').resolves([]);
    sinon.stub(QueueService.prototype as any, 'getAverageSessionDuration').resolves(300_000);

    sinon.stub(prisma.device, 'findMany').callsFake((async (args: any) => {
      const udid = args?.where?.udid;
      return DEVICES.filter((d) =>
        typeof udid === 'string' ? d.udid === udid : udid.in.includes(d.udid),
      ).map((d) => ({ ...d }));
    }) as any);
    sinon.stub(prisma.device, 'findFirst').callsFake((async (args: any) => {
      const found = DEVICES.find((d) => d.udid === args?.where?.udid);
      return found ? { ...found } : null;
    }) as any);
    sinon.stub(prisma.teamMember, 'findMany').callsFake((async (args: any) => {
      const userId = args?.where?.userId;
      return MEMBERSHIPS.filter((m) =>
        typeof userId === 'string' ? m.userId === userId : userId.in.includes(m.userId),
      ).map((m) => ({ ...m }));
    }) as any);
  });

  afterEach(() => sinon.restore());

  describe('a member in team A', () => {
    it("GET /queue shows the request for her team's phone and her teammate's, nothing else", async () => {
      const r = await request(alice()).get('/queue');
      expect(r.status).to.equal(200);
      expect(ids(r.body)).to.deep.equal(['targets-a', 'untargeted-a']);
      expect(JSON.stringify(r.body)).to.not.include('bob-secret-release');
      expect(JSON.stringify(r.body)).to.not.include('bob-targeted');
    });

    it('GET /queue never returns who asked', async () => {
      const r = await request(alice()).get('/queue');
      for (const shown of r.body) expect(shown).to.not.have.property(REQUESTER);
    });

    it('GET /queue/length is the whole queue, the number every caller gets', async () => {
      const r = await request(alice()).get('/queue/length');
      expect(r.status).to.equal(200);
      expect(r.body).to.equal(4);
    });

    it('GET /queue/summary agrees with /queue/length, and counts what she cannot see', async () => {
      const r = await request(alice()).get('/queue/summary');
      expect(r.status).to.equal(200);
      expect(r.body.total).to.equal(4);
      expect(r.body.otherCount).to.equal(2);
      const byPlatform = Object.values(r.body.byPlatform) as Array<{ count: number }>;
      expect(byPlatform.reduce((n, p) => n + p.count, 0)).to.equal(4);
    });

    it("GET /queue/status answers for another team's request exactly as for an unknown id", async () => {
      const unknown = await request(alice()).get('/queue/status/no-such-request');
      expect(unknown.status).to.equal(404);
      for (const hidden of ['targets-b', 'untargeted-b']) {
        const r = await request(alice()).get(`/queue/status/${hidden}`);
        expect(r.status, hidden).to.equal(404);
        expect(r.body, hidden).to.deep.equal(unknown.body);
      }
    });

    it('GET /queue/status still answers for the requests she can see', async () => {
      for (const shown of ['targets-a', 'untargeted-a']) {
        const r = await request(alice()).get(`/queue/status/${shown}`);
        expect(r.status, shown).to.equal(200);
        expect(r.body.platform, shown).to.equal('android');
      }
    });
  });

  describe('an admin', () => {
    it('GET /queue shows all four', async () => {
      const r = await request(admin()).get('/queue');
      expect(r.status).to.equal(200);
      expect(ids(r.body)).to.deep.equal(['targets-a', 'targets-b', 'untargeted-a', 'untargeted-b']);
      for (const shown of r.body) expect(shown).to.not.have.property(REQUESTER);
    });

    it('with no lookup of phones or teams', async () => {
      await request(admin()).get('/queue');
      expect((prisma.device.findMany as sinon.SinonStub).called).to.equal(false);
      expect((prisma.teamMember.findMany as sinon.SinonStub).called).to.equal(false);
    });

    it('GET /queue/summary counts nothing as hidden', async () => {
      const r = await request(admin()).get('/queue/summary');
      expect(r.body.total).to.equal(4);
      expect(r.body.otherCount).to.equal(0);
    });

    it('GET /queue/length and /queue/status answer as before', async () => {
      expect((await request(admin()).get('/queue/length')).body).to.equal(4);
      const r = await request(admin()).get('/queue/status/untargeted-b');
      expect(r.status).to.equal(200);
    });
  });

  // The row is the capabilities the client sent, credentials included. A
  // teammate's request is Alice's to see; the key that signed it is not, and
  // nor is it an admin's.
  describe('credentials in a waiting request', () => {
    for (const [who, caller] of [
      ['a teammate', alice],
      ['an admin', admin],
    ] as const) {
      it(`are never returned to ${who}`, async () => {
        const r = await request(caller()).get('/queue');
        const shown = r.body.find((x: any) => x.capability_id === 'untargeted-a');
        expect(shown, 'the request itself is shown').to.not.equal(undefined);
        expect(JSON.stringify(r.body)).to.not.include('amy-api-token');
        expect(JSON.stringify(r.body)).to.not.include('amy.session.jwt');
        // What isn't a secret still reads as before.
        expect(shown['df:options'].accessKey).to.equal('ak_amy');
        expect(shown['xenon:options'].sessionName).to.equal('amy-login');
      });
    }
  });
});
