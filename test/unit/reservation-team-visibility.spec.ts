import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import reservationRouter from '../../src/app/routers/reservation';
import * as deviceService from '../../src/data-service/device-service';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { prisma } from '../../src/prisma';
import { scopesForRole } from '../../src/middleware/authMiddleware';

/**
 * Reservations are inside the team boundary. A member can reserve, extend and
 * release only a phone they can see, and the list shows only reservations on
 * those phones. Another team's phone answers exactly like an unknown udid.
 */

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';
const HOST = 'http://127.0.0.1:4723';

type Caller = { role: 'MEMBER' | 'ADMIN'; teamIds?: string[] };
const ALICE: Caller = { role: 'MEMBER', teamIds: [TEAM_A] };
const NO_TEAM: Caller = { role: 'MEMBER', teamIds: [] };
const ADMIN: Caller = { role: 'ADMIN' };

const SHARED = 'RES-SHARED';
const PHONE_A = 'RES-A';
const PHONE_B = 'RES-B';
const UNKNOWN = 'RES-UNKNOWN';

const TEAM_OF: Record<string, string | null> = {
  [SHARED]: null,
  [PHONE_A]: TEAM_A,
  [PHONE_B]: TEAM_B,
};

/** Every phone is reserved by alice, so reserve (a re-reserve), extend and release all apply. */
function device(udid: string) {
  return {
    udid,
    host: HOST,
    name: udid,
    platform: 'android',
    teamId: TEAM_OF[udid],
    busy: false,
    reservedBy: 'alice',
    reservedUntil: Date.now() + 60 * 60 * 1000,
    reservationReason: 'testing',
  };
}

function buildApp(caller: Caller) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId: `usr_${caller.role.toLowerCase()}`,
      role: caller.role,
      scopes: scopesForRole(caller.role),
      rateLimit: 100,
      teamIds: caller.teamIds,
    };
    next();
  });
  app.use('/reservation', reservationRouter);
  return app;
}

const reserve = (caller: Caller, udid: string) =>
  request(buildApp(caller))
    .post('/reservation')
    .send({ udid, host: HOST, reservedBy: 'alice', duration: '1h' });
const extend = (caller: Caller, udid: string) =>
  request(buildApp(caller))
    .post(`/reservation/${udid}/${encodeURIComponent(HOST)}/extend`)
    .send({ duration: '1h' });
const release = (caller: Caller, udid: string) =>
  request(buildApp(caller)).delete(`/reservation/${udid}/${encodeURIComponent(HOST)}`);

describe('reservations respect the team boundary', () => {
  let reserveDevice: sinon.SinonStub;
  let releaseReservation: sinon.SinonStub;

  beforeEach(() => {
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async (f: any) =>
        f.udid in TEAM_OF && f.host === HOST ? (device(f.udid) as any) : null,
    } as any);
    sinon
      .stub(deviceService, 'getReservedDevices')
      .resolves([SHARED, PHONE_A, PHONE_B].map(device) as any);
    reserveDevice = sinon.stub(deviceService, 'reserveDevice').resolves();
    releaseReservation = sinon.stub(deviceService, 'releaseReservation').resolves();
    // filterRowsByVisibleDevice runs for real; only its Device lookup is faked.
    sinon
      .stub(prisma.device as any, 'findMany')
      .callsFake(async (q: any) =>
        (q.where.udid.in as string[])
          .filter((u) => u in TEAM_OF)
          .map((udid) => ({ udid, teamId: TEAM_OF[udid] })),
      );
  });

  afterEach(() => sinon.restore());

  describe("a team-A member on team B's phone", () => {
    it('gets 404 on reserve, and nothing is reserved', async () => {
      const res = await reserve(ALICE, PHONE_B);
      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({ success: false, error: 'Device not found' });
      expect(reserveDevice.called).to.equal(false);
    });

    it('gets 404 on extend, and nothing is extended', async () => {
      const res = await extend(ALICE, PHONE_B);
      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({ success: false, error: 'Device not found' });
      expect(reserveDevice.called).to.equal(false);
    });

    it('gets 404 on release, and nothing is released', async () => {
      const res = await release(ALICE, PHONE_B);
      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({ success: false, error: 'Device not found' });
      expect(releaseReservation.called).to.equal(false);
    });
  });

  it('answers each of them exactly as it answers an unknown udid', async () => {
    for (const op of [reserve, extend, release]) {
      const hidden = await op(ALICE, PHONE_B);
      const unknown = await op(ALICE, UNKNOWN);
      expect(hidden.status).to.equal(unknown.status);
      expect(hidden.text).to.equal(unknown.text);
    }
  });

  it("lets a team-A member reserve, extend and release team A's and shared phones", async () => {
    for (const udid of [PHONE_A, SHARED]) {
      expect((await reserve(ALICE, udid)).status, `reserve ${udid}`).to.equal(200);
      expect((await extend(ALICE, udid)).status, `extend ${udid}`).to.equal(200);
      expect((await release(ALICE, udid)).status, `release ${udid}`).to.equal(200);
    }
  });

  it("lets an admin reserve, extend and release team B's phone", async () => {
    expect((await reserve(ADMIN, PHONE_B)).status).to.equal(200);
    expect((await extend(ADMIN, PHONE_B)).status).to.equal(200);
    expect((await release(ADMIN, PHONE_B)).status).to.equal(200);
  });

  describe('the list', () => {
    const listed = async (caller: Caller) => {
      const res = await request(buildApp(caller)).get('/reservation');
      expect(res.status).to.equal(200);
      return (res.body.reservations as Array<{ udid: string }>).map((r) => r.udid).sort();
    };

    it("hides other teams' reservations from a member", async () => {
      expect(await listed(ALICE)).to.deep.equal([PHONE_A, SHARED].sort());
    });

    it('shows a member in no team only the shared pool', async () => {
      expect(await listed(NO_TEAM)).to.deep.equal([SHARED]);
    });

    it('shows an admin every reservation', async () => {
      expect(await listed(ADMIN)).to.deep.equal([PHONE_A, PHONE_B, SHARED].sort());
    });
  });
});
