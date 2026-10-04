import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import grid from '../../src/app/routers/grid';
import reservationRouter from '../../src/app/routers/reservation';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

/**
 * Blocking and reserving a phone act on exactly the phone named, by udid and
 * host, and a reservation is changed only by whoever took it, or an admin.
 */

const UDID = 'R5CT32ABCDE';
const HOST = 'http://192.168.1.100:4723';
const OTHER_HOST = 'http://192.168.1.101:4723';
const HOUR = 60 * 60 * 1000;

type Caller = { userId: string; role: 'MEMBER' | 'ADMIN'; scopes: string };
const DANA: Caller = { userId: 'usr_dana', role: 'MEMBER', scopes: 'devices,sessions,read' };
const LEE: Caller = { userId: 'usr_lee', role: 'MEMBER', scopes: 'devices,sessions,read' };
const ADMIN: Caller = { userId: 'usr_admin', role: 'ADMIN', scopes: 'admin,devices,sessions,read' };

/** A store with the phone on HOST, and each phone write recorded. */
function fakeStore(phone: Record<string, unknown> = {}) {
  const rows: Array<Record<string, unknown>> = [
    { udid: UDID, host: HOST, name: 'Pixel 7', platform: 'android', teamId: null, ...phone },
    { udid: UDID, host: OTHER_HOST, name: 'Pixel 7', platform: 'android', teamId: null },
  ];
  const writes: Array<{ udid: string; host: string; data: Record<string, unknown> }> = [];
  const store = {
    findDevice: async (filter: { udid?: string; host?: string }) =>
      rows.find((r) => r.udid === filter.udid && r.host === filter.host) ?? null,
    updateDevice: async (udid: string, host: string, data: Record<string, unknown>) => {
      writes.push({ udid, host, data });
      const row = rows.find((r) => r.udid === udid && r.host === host);
      if (row) Object.assign(row, data);
    },
  };
  sinon.stub(DeviceStoreFactory, 'getStore').returns(store as any);
  return { rows, writes };
}

function appAs(caller: Caller, mount: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = { kind: 'user-session', rateLimit: 1000, ...caller };
    next();
  });
  mount(app);
  return app;
}

describe('device allocation routes', () => {
  afterEach(() => sinon.restore());

  describe('POST /block and /unblock', () => {
    const app = () =>
      appAs(ADMIN, (a) => {
        const router = express.Router();
        grid.register(router, { bindHostOrIp: '127.0.0.1' } as any);
        a.use(router);
      });

    for (const path of ['/block', '/unblock']) {
      for (const [what, body] of [
        ['an empty body', {}],
        ['no host', { udid: UDID }],
        ['no udid', { host: HOST }],
        ['a udid that is not a string', { udid: 42, host: HOST }],
      ] as const) {
        it(`${path} answers 400 for ${what}, and changes nothing`, async () => {
          const { writes } = fakeStore();
          const r = await request(app()).post(path).send(body).timeout(5000);
          expect(r.status).to.equal(400);
          expect(r.body).to.deep.equal({
            success: false,
            error: 'bad_request',
            message: 'udid and host are required',
          });
          expect(writes).to.deep.equal([]);
        });
      }

      it(`${path} answers 404 for a host the phone is not on`, async () => {
        const { writes } = fakeStore();
        const r = await request(app())
          .post(path)
          .send({ udid: UDID, host: 'http://10.0.0.9:4723' })
          .timeout(5000);
        expect(r.status).to.equal(404);
        expect(writes).to.deep.equal([]);
      });
    }

    it('blocks the phone on the host named, not another row of its udid', async () => {
      const { writes } = fakeStore();
      const r = await request(app())
        .post('/block')
        .send({ udid: UDID, host: OTHER_HOST })
        .timeout(5000);
      expect(r.status).to.equal(200);
      expect(writes).to.deep.equal([{ udid: UDID, host: OTHER_HOST, data: { userBlocked: true } }]);
    });
  });

  describe('/reservation', () => {
    const app = (caller: Caller) => appAs(caller, (a) => a.use('/reservation', reservationRouter));
    const reserved = (userId: string | null) => ({
      reservedBy: 'Dana',
      reservedByUserId: userId,
      reservedUntil: Date.now() + HOUR,
      reservationReason: 'release testing',
    });
    const hostPath = encodeURIComponent(HOST);

    it('answers 404 when the phone is not on the host named, and reserves nothing', async () => {
      const { writes } = fakeStore();
      const r = await request(app(DANA))
        .post('/reservation')
        .send({ udid: UDID, host: 'http://10.0.0.9:4723', reservedBy: 'Dana', duration: '1h' })
        .timeout(5000);
      expect(r.status).to.equal(404);
      expect(writes).to.deep.equal([]);
    });

    it('records who reserved the phone', async () => {
      const { rows } = fakeStore();
      const r = await request(app(DANA))
        .post('/reservation')
        .send({ udid: UDID, host: HOST, reservedBy: 'Dana', duration: '1h' })
        .timeout(5000);
      expect(r.status).to.equal(200);
      expect(rows[0]).to.include({ reservedBy: 'Dana', reservedByUserId: DANA.userId });
    });

    it("refuses someone else's reservation even under the same name", async () => {
      fakeStore(reserved(DANA.userId));
      const r = await request(app(LEE))
        .post('/reservation')
        .send({ udid: UDID, host: HOST, reservedBy: 'Dana', duration: '1h' })
        .timeout(5000);
      expect(r.status).to.equal(409);
    });

    it('lets the holder renew their own reservation', async () => {
      fakeStore(reserved(DANA.userId));
      const r = await request(app(DANA))
        .post('/reservation')
        .send({ udid: UDID, host: HOST, reservedBy: 'Dana', duration: '2h' })
        .timeout(5000);
      expect(r.status).to.equal(200);
    });

    for (const [what, call] of [
      ['release', (a: express.Express) => request(a).delete(`/reservation/${UDID}/${hostPath}`)],
      [
        'extend',
        (a: express.Express) =>
          request(a).post(`/reservation/${UDID}/${hostPath}/extend`).send({ duration: '1h' }),
      ],
    ] as const) {
      it(`refuses to let another member ${what} it, and changes nothing`, async () => {
        const { writes } = fakeStore(reserved(DANA.userId));
        const r = await call(app(LEE)).timeout(5000);
        expect(r.status).to.equal(403);
        expect(r.body).to.deep.equal({
          success: false,
          error: 'not_reservation_holder',
          message:
            'Only the person who reserved this device, or an admin, can change the reservation.',
        });
        expect(writes).to.deep.equal([]);
      });

      it(`lets the holder ${what} it`, async () => {
        fakeStore(reserved(DANA.userId));
        expect((await call(app(DANA)).timeout(5000)).status).to.equal(200);
      });

      it(`lets an admin ${what} it`, async () => {
        fakeStore(reserved(DANA.userId));
        expect((await call(app(ADMIN)).timeout(5000)).status).to.equal(200);
      });

      it(`lets anyone ${what} a reservation that names no user (taken before 2.13)`, async () => {
        fakeStore(reserved(null));
        expect((await call(app(LEE)).timeout(5000)).status).to.equal(200);
      });

      it(`answers 404 for ${what} on a host the phone is not on`, async () => {
        fakeStore(reserved(DANA.userId));
        const a = app(DANA);
        const r =
          what === 'release'
            ? await request(a).delete(
                `/reservation/${UDID}/${encodeURIComponent('http://10.0.0.9:4723')}`,
              )
            : await request(a)
                .post(`/reservation/${UDID}/${encodeURIComponent('http://10.0.0.9:4723')}/extend`)
                .send({ duration: '1h' });
        expect(r.status).to.equal(404);
      });
    }

    it('keeps the holder when a reservation is extended', async () => {
      const { rows } = fakeStore(reserved(DANA.userId));
      await request(app(ADMIN))
        .post(`/reservation/${UDID}/${hostPath}/extend`)
        .send({ duration: '1h' })
        .timeout(5000);
      expect(rows[0].reservedByUserId).to.equal(DANA.userId);
    });

    for (const [what, duration] of [
      ['past 24 hours from now', 24 * HOUR],
      ['by a negative duration', -HOUR],
      ['by less than a minute', 1000],
    ] as const) {
      it(`refuses to extend it ${what}`, async () => {
        const { writes } = fakeStore(reserved(DANA.userId));
        const r = await request(app(DANA))
          .post(`/reservation/${UDID}/${hostPath}/extend`)
          .send({ duration })
          .timeout(5000);
        expect(r.status).to.equal(400);
        expect(writes).to.deep.equal([]);
      });
    }

    it('extends it up to 24 hours from now', async () => {
      const { rows } = fakeStore(reserved(DANA.userId));
      const r = await request(app(DANA))
        .post(`/reservation/${UDID}/${hostPath}/extend`)
        .send({ duration: 22 * HOUR })
        .timeout(5000);
      expect(r.status).to.equal(200);
      expect(rows[0].reservedUntil as number).to.be.at.most(Date.now() + 24 * HOUR);
    });

    it('clears the holder when the reservation is released', async () => {
      const { rows } = fakeStore(reserved(DANA.userId));
      await request(app(DANA)).delete(`/reservation/${UDID}/${hostPath}`).timeout(5000);
      expect(rows[0]).to.include({ reservedBy: null, reservedByUserId: null, reservedUntil: null });
    });
  });
});
