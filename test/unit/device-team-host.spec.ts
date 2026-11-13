import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { useScratchDatabase } from '../helpers/scratch-database';
import { saveRegistrations } from '../helpers/container-registration';
import { OWN_NODE_ID } from '../helpers/own-node-id';
import GridRouter from '../../src/app/routers/grid';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { addNewDevice } from '../../src/data-service/device-service';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';
import { SocketServer } from '../../src/services/SocketServer';
import { NotificationService } from '../../src/services/NotificationService';
import { DeviceTeamResolver } from '../../src/services/device-access/DeviceTeamResolver';

/**
 * `PUT /device/:udid/team` and a udid two servers report (emulator-5554 on a
 * hub and on its node). Through 2.33 the route moved
 * every phone of the udid; now `host` (body or query) names one, and a udid
 * on two hosts without one is `409 ambiguous_phone` and moves nothing.
 */

const IP = '10.0.0.1';
const OWN = `http://${IP}:4723`;
const NODE = `http://${IP}:4725`;
const AWAY = 'http://10.0.0.9:4723';
const UDID = 'emulator-5554';

const ADMIN = { userId: 'usr_admin', role: 'ADMIN', scopes: 'admin,devices,sessions,read' };

const phone = (udid: string, host = OWN): IDevice =>
  ({
    udid,
    host,
    name: `Phone ${udid}`,
    platform: 'android',
    deviceType: 'real',
    realDevice: true,
    state: 'device',
    sdk: '14',
    busy: false,
    userBlocked: false,
    totalUtilizationTimeMilliSec: 0,
    sessionStartTime: 0,
    nodeId: host === OWN ? OWN_NODE_ID : 'node-1',
  }) as IDevice;

function admin() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { kind: 'user-session', rateLimit: 1000, ...ADMIN };
    next();
  });
  const router = express.Router();
  GridRouter.register(router, { ...DefaultPluginArgs, bindHostOrIp: IP } as IPluginArgs);
  app.use(router);
  return app;
}

describe('PUT /device/:udid/team names a phone by udid and host', () => {
  const scratch = useScratchDatabase();
  let savedStore: unknown;
  let restoreContainer: () => void;
  let noted: Array<[string, string, string | null]>;

  const saved = (host: string, udid = UDID) =>
    scratch.db.deviceSetting.findUnique({ where: { udid_host: { udid, host } } });
  const row = (host: string, udid = UDID) =>
    DeviceStoreFactory.getStore().findDevice({ udid, host });
  const teamOf = async (host: string) => (await saved(host))?.teamId ?? null;

  beforeEach(async () => {
    noted = [];
    restoreContainer = saveRegistrations(SocketServer, NotificationService, DeviceTeamResolver);
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: () => undefined,
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      },
    });
    Container.set({ id: NotificationService, value: { dispatchEvent: async () => undefined } });
    Container.set({
      id: DeviceTeamResolver,
      value: {
        note: (udid: string, host: string, teamId: string | null) =>
          noted.push([udid, host, teamId]),
      },
    });
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    await scratch.db.deviceSetting.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.team.deleteMany({});
    await scratch.db.team.create({ data: { id: 'team-a', name: 'Team A' } });
  });

  afterEach(() => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restoreContainer();
  });

  describe('with a host', () => {
    beforeEach(async () => {
      await addNewDevice([phone(UDID), phone(UDID, NODE)]);
    });

    it('moves only the phone the body names', async () => {
      const r = await request(admin())
        .put(`/device/${UDID}/team`)
        .send({ teamId: 'team-a', host: NODE });

      expect(r.status, JSON.stringify(r.body)).to.equal(200);
      expect(r.body).to.deep.equal({ ok: true, updated: 1 });
      expect(await row(NODE)).to.include({ teamId: 'team-a' });
      expect((await row(OWN))?.teamId ?? null).to.equal(null);
      expect(await teamOf(NODE)).to.equal('team-a');
      expect(await teamOf(OWN)).to.equal(null);
    });

    it('moves only the phone the query names', async () => {
      const r = await request(admin())
        .put(`/device/${UDID}/team?host=${encodeURIComponent(OWN)}`)
        .send({ teamId: 'team-a' });

      expect(r.status, JSON.stringify(r.body)).to.equal(200);
      expect(r.body).to.deep.equal({ ok: true, updated: 1 });
      expect(await row(OWN)).to.include({ teamId: 'team-a' });
      expect((await row(NODE))?.teamId ?? null).to.equal(null);
    });

    it('takes the same host in the body and the query', async () => {
      const r = await request(admin())
        .put(`/device/${UDID}/team?host=${encodeURIComponent(NODE)}`)
        .send({ teamId: 'team-a', host: NODE });

      expect(r.status, JSON.stringify(r.body)).to.equal(200);
      expect(await teamOf(NODE)).to.equal('team-a');
      expect(await teamOf(OWN)).to.equal(null);
    });

    it('moves a phone that is not connected now, by its saved settings', async () => {
      await scratch.db.deviceSetting.create({ data: { udid: UDID, host: AWAY } });

      const r = await request(admin())
        .put(`/device/${UDID}/team`)
        .send({ teamId: 'team-a', host: AWAY });

      expect(r.status, JSON.stringify(r.body)).to.equal(200);
      expect(r.body).to.deep.equal({ ok: true, updated: 1 });
      expect(await teamOf(AWAY)).to.equal('team-a');
      expect(await teamOf(OWN)).to.equal(null);
      expect(await teamOf(NODE)).to.equal(null);
    });

    it('answers 404 for a host no phone of the udid has, and moves nothing', async () => {
      const r = await request(admin())
        .put(`/device/${UDID}/team`)
        .send({ teamId: 'team-a', host: 'http://10.0.0.77:4723' });

      expect(r.status).to.equal(404);
      expect(r.body).to.deep.equal({ error: 'device not found' });
      expect(await teamOf(OWN)).to.equal(null);
      expect(await teamOf(NODE)).to.equal(null);
    });

    it('tells the live events the moved phone’s team, while another phone keeps the udid', async () => {
      await request(admin()).put(`/device/${UDID}/team`).send({ teamId: 'team-a', host: NODE });

      expect(noted).to.deep.equal([[UDID, NODE, 'team-a']]);
    });
  });

  describe('without a host', () => {
    it('moves the udid as before when one host has it', async () => {
      await addNewDevice([phone(UDID)]);

      const r = await request(admin()).put(`/device/${UDID}/team`).send({ teamId: 'team-a' });

      expect(r.status, JSON.stringify(r.body)).to.equal(200);
      expect(r.body).to.deep.equal({ ok: true, updated: 1 });
      expect(await row(OWN)).to.include({ teamId: 'team-a' });
      expect(noted).to.deep.equal([[UDID, OWN, 'team-a']]);
    });

    it('answers 409 ambiguous_phone, every host listed, when two hosts have it', async () => {
      await addNewDevice([phone(UDID, NODE), phone(UDID)]);
      await scratch.db.deviceSetting.create({ data: { udid: UDID, host: AWAY } });

      const r = await request(admin()).put(`/device/${UDID}/team`).send({ teamId: 'team-a' });

      expect(r.status).to.equal(409);
      expect(r.body).to.deep.equal({
        error: 'ambiguous_phone',
        message: `Two servers have a phone named ${UDID}. Name the one you mean with its host.`,
        hosts: [OWN, NODE, AWAY].sort(),
      });
      for (const host of [OWN, NODE, AWAY]) expect(await teamOf(host), host).to.equal(null);
      expect(noted).to.deep.equal([]);
    });

    it('counts a phone that is only saved as a second host', async () => {
      await addNewDevice([phone(UDID)]);
      await scratch.db.deviceSetting.create({ data: { udid: UDID, host: AWAY } });

      const r = await request(admin()).put(`/device/${UDID}/team`).send({ teamId: 'team-a' });

      expect(r.status).to.equal(409);
      expect(r.body.hosts).to.deep.equal([OWN, AWAY].sort());
    });
  });

  describe('an invalid host', () => {
    beforeEach(async () => {
      await addNewDevice([phone(UDID), phone(UDID, NODE)]);
    });

    const refused = async (r: { status: number; body: unknown }) => {
      expect(r.status, JSON.stringify(r.body)).to.equal(400);
      expect(r.body).to.deep.equal({ error: 'invalid_host' });
      expect(await teamOf(OWN)).to.equal(null);
      expect(await teamOf(NODE)).to.equal(null);
    };

    it('answers 400 for an empty host in the query', async () => {
      await refused(
        await request(admin()).put(`/device/${UDID}/team?host=`).send({ teamId: 'team-a' }),
      );
    });

    it('answers 400 for a host given twice in the query', async () => {
      await refused(
        await request(admin())
          .put(
            `/device/${UDID}/team?host=${encodeURIComponent(OWN)}&host=${encodeURIComponent(NODE)}`,
          )
          .send({ teamId: 'team-a' }),
      );
    });

    it('answers 400 for a host in the body that is not a string', async () => {
      await refused(
        await request(admin()).put(`/device/${UDID}/team`).send({ teamId: 'team-a', host: 4723 }),
      );
    });

    it('answers 400 for an empty host in the body', async () => {
      await refused(
        await request(admin()).put(`/device/${UDID}/team`).send({ teamId: 'team-a', host: '' }),
      );
    });

    it('answers 400 when the body and the query name different hosts', async () => {
      await refused(
        await request(admin())
          .put(`/device/${UDID}/team?host=${encodeURIComponent(OWN)}`)
          .send({ teamId: 'team-a', host: NODE }),
      );
    });
  });
});
