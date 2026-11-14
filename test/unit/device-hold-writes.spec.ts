import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { releaseBlockedDevices } from '../../src/device-utils';
import { DeviceReconciler } from '../../src/services/DeviceReconciler';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { AutowaitService } from '../../src/services/autowait/AutowaitService';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { SocketServer } from '../../src/services/SocketServer';
import { RecordingStore } from '../../src/services/recording/recording-store';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import * as ownDeviceRow from '../../src/device-managers/ownDeviceRow';
import { releaseIdlePreviewHold } from '../../src/device-managers/android/previewHold';
import { createHubRouting, createSessionGatewayLayer } from '../../src/gateway/sessionGateway';
import { IDevice } from '../../src/interfaces/IDevice';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { useLokiStores, usePrismaStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * Who owns a phone's idle clock (`lastCmdExecutedAt`), and whose hold a
 * write may replace or end.
 *
 * - The idle sweeper (releaseBlockedDevices) frees a session's phone a
 *   new-command timeout after its last command. That clock was touched when a
 *   command started only, so one command longer than the timeout (a heal that
 *   reaches the AI tiers, a big install) got its phone freed while the driver
 *   still ran it. Appium pauses its own timer during a command.
 * - A lease's stamps were left on the row when its lock went, and a preview
 *   hold's write meant to clear the clock (`undefined`) wrote nothing on
 *   Prisma, so the next preview or recording inherited a stale clock and the
 *   sweeper (or the reconciler, by `sessionStartTime`) released it within
 *   seconds, while someone watched.
 * - A preview hold was read, then written: over a pending claim, or beside a
 *   claim taken in between. Its release wrote the whole claim away.
 */

const HOST = 'http://127.0.0.1:4723';
const UDID = 'hold-phone-1';
const SESSION = 'appium-session-1';
const HOLD = `manual_usr_alice_${UDID}`;
const HOUR = 60 * 60 * 1000;

const phone = (over: Partial<IDevice> = {}) =>
  ({
    udid: UDID,
    name: UDID,
    platform: 'android',
    sdk: '13',
    host: HOST,
    nodeId: OWN_NODE_ID,
    busy: false,
    offline: false,
    userBlocked: false,
    state: 'device',
    deviceType: 'real',
    realDevice: true,
    totalUtilizationTimeMilliSec: 0,
    sessionStartTime: 0,
    ...over,
  }) as unknown as IDevice;

const store = () => DeviceStoreFactory.getStore();
const row = async () => (await store().findDevice({ udid: UDID, host: HOST })) as IDevice;

/** The phone, fresh, with these runtime columns written over it. */
async function seed(runtime: Partial<IDevice>) {
  await store().removeDevices({ udid: UDID, host: HOST }, { exactHost: true });
  await store().addDevices([phone()]);
  await store().updateDevice(UDID, HOST, runtime);
}

async function until(check: () => Promise<boolean> | boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Phone holds and the idle clock', function () {
  this.timeout(30_000);
  useScratchDatabase();
  useOwnNodeId();
  let restoreContainer: () => void;

  beforeEach(() => {
    restoreContainer = saveRegistrations(SocketServer);
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      },
    });
  });

  afterEach(async () => {
    sinon.restore();
    restoreContainer();
  });

  for (const [name, useStores] of [
    ['Prisma', usePrismaStores],
    ['Loki', useLokiStores],
  ] as const) {
    describe(`the stores (${name})`, () => {
      useStores();

      after(async () => {
        // Loki is one collection for the whole process.
        await DeviceStoreFactory.getStore().removeDevices(
          { udid: UDID, host: HOST },
          { exactHost: true },
        );
      });

      it("ending a lease's lock clears the lease's clock with it", async () => {
        const stamp = Date.now() - HOUR;
        await seed({ busy: true, lastCmdExecutedAt: stamp, sessionStartTime: stamp });

        expect(await store().releaseLeaseLock(UDID, HOST)).to.equal(true);

        const after = await row();
        expect(after.busy).to.equal(false);
        expect(after.lastCmdExecutedAt ?? null, 'lastCmdExecutedAt').to.equal(null);
        expect(after.sessionStartTime || 0, 'sessionStartTime').to.equal(0);
      });

      it("ending a lease's lock leaves a session's clock on the phone alone", async () => {
        const stamp = Date.now() - 1_000;
        await seed({
          busy: true,
          claimedAt: stamp,
          claimSessionId: SESSION,
          session_id: SESSION,
          lastCmdExecutedAt: stamp,
          sessionStartTime: stamp,
        });

        expect(await store().releaseLeaseLock(UDID, HOST)).to.equal(false);
        expect((await row()).lastCmdExecutedAt).to.equal(stamp);
      });

      it("a session's clock is touched through its claim, a preview hold in session_id beside it", async () => {
        const stamp = Date.now() - HOUR;
        await seed({
          busy: true,
          claimedAt: stamp,
          claimSessionId: SESSION,
          session_id: HOLD,
          lastCmdExecutedAt: stamp,
        });
        const now = Date.now();

        await store().touchSession(SESSION, now);

        expect((await row()).lastCmdExecutedAt).to.equal(now);
      });

      it('a row from before claims (session_id only) is still touched', async () => {
        await seed({ busy: true, session_id: SESSION, lastCmdExecutedAt: 1 });
        await store().touchSession(SESSION, 42);
        expect((await row()).lastCmdExecutedAt).to.equal(42);
      });

      it('a preview hold leaves no clock behind, even where a lease left one', async () => {
        await seed({ busy: false, lastCmdExecutedAt: Date.now() - HOUR });

        const took = await deviceService.blockDevice(UDID, HOST, HOLD);

        const after = await row();
        expect(after.session_id).to.equal(HOLD);
        expect(after.busy).to.equal(true);
        expect(after.lastCmdExecutedAt ?? null).to.equal(null);
        expect(took, 'says it took').to.equal(true);
      });

      it('a preview hold is not written over a pending claim', async () => {
        const claimedAt = Date.now() - 1_000;
        await seed({ busy: true, claimedAt, lastCmdExecutedAt: claimedAt });

        const took = await deviceService.blockDevice(UDID, HOST, HOLD);

        const after = await row();
        expect(after.session_id ?? null).to.equal(null);
        expect(after.claimedAt).to.equal(claimedAt);
        expect(took, 'says it did not take').to.equal(false);
        // The session then takes its claim as it would have.
        expect(await store().claimForSession(UDID, HOST, claimedAt, SESSION, {})).to.equal(true);
      });

      it("a preview hold is not written over an Appium session's id, with or without a claim", async () => {
        await seed({ busy: true, session_id: SESSION });
        const first = await deviceService.blockDevice(UDID, HOST, HOLD);
        expect((await row()).session_id).to.equal(SESSION);

        await seed({ busy: true, claimedAt: 5, claimSessionId: SESSION, session_id: SESSION });
        const second = await deviceService.blockDevice(UDID, HOST, HOLD);
        expect((await row()).session_id).to.equal(SESSION);
        expect([first, second], 'says neither took').to.deep.equal([false, false]);

        // An id that only looks like a hold to SQL's LIKE (`_` is a wildcard).
        await seed({ busy: true, session_id: 'manualXsession' });
        expect(await deviceService.blockDevice(UDID, HOST, HOLD)).to.equal(false);
        expect(await deviceService.releaseManualHold(UDID, HOST)).to.equal(false);
        expect((await row()).session_id).to.equal('manualXsession');
      });

      it("a preview hold replaces a manual hold (an admin taking over another user's preview)", async () => {
        await seed({ busy: true, session_id: `manual_usr_bob_${UDID}` });
        const took = await deviceService.blockDevice(UDID, HOST, HOLD);
        expect((await row()).session_id).to.equal(HOLD);
        expect(took).to.equal(true);
      });

      it('a claim taken between a hold read and its write keeps the phone', async () => {
        // The race the read-then-write had: the hold reads a pending claim
        // with no session id, the session takes the claim, then the hold
        // writes. One conditional update leaves no gap.
        const claimedAt = Date.now() - 1_000;
        await seed({ busy: true, claimedAt });
        const s = store();
        const findDevice = s.findDevice.bind(s);
        let claimed = false;
        const claim = async () => {
          if (claimed) return;
          claimed = true;
          await s.claimForSession(UDID, HOST, claimedAt, SESSION, { session_id: SESSION });
        };
        sinon.stub(s, 'findDevice').callsFake(async (filter: any) => {
          const found = await findDevice(filter);
          await claim();
          return found;
        });

        await deviceService.blockDevice(UDID, HOST, HOLD);
        await claim();
        sinon.restore();

        const after = await row();
        expect(after.claimSessionId).to.equal(SESSION);
        expect(after.session_id).to.equal(SESSION);
      });

      it("ending a preview hold leaves a session's claim beside it, and the phone busy", async () => {
        const claimedAt = Date.now() - 1_000;
        await seed({
          busy: true,
          claimedAt,
          claimSessionId: SESSION,
          session_id: HOLD,
          lastCmdExecutedAt: claimedAt,
        });

        expect(await deviceService.releaseManualHold(UDID, HOST, HOLD)).to.equal(true);

        const after = await row();
        expect(after.session_id ?? null).to.equal(null);
        expect(after.claimSessionId).to.equal(SESSION);
        expect(after.claimedAt).to.equal(claimedAt);
        expect(after.lastCmdExecutedAt).to.equal(claimedAt);
        expect(after.busy).to.equal(true);
      });

      it('ending a preview hold frees a phone nothing else holds', async () => {
        await seed({ busy: true, session_id: HOLD });
        expect(await deviceService.releaseManualHold(UDID, HOST, HOLD)).to.equal(true);
        const after = await row();
        expect(after.session_id ?? null).to.equal(null);
        expect(after.busy).to.equal(false);
      });

      it('ending a preview hold keeps a node-reported busy phone busy', async () => {
        await seed({ busy: true, session_id: HOLD, nodeBusy: true });
        await deviceService.releaseManualHold(UDID, HOST, HOLD);
        expect((await row()).busy).to.equal(true);
      });

      it('ending one hold never ends another: not a session, nor a newer hold', async () => {
        await seed({ busy: true, session_id: SESSION });
        expect(await deviceService.releaseManualHold(UDID, HOST, HOLD)).to.equal(false);
        expect(await deviceService.releaseManualHold(UDID, HOST)).to.equal(false);
        expect((await row()).session_id).to.equal(SESSION);
        expect((await row()).busy).to.equal(true);

        const bobs = `manual_usr_bob_${UDID}`;
        await seed({ busy: true, session_id: bobs });
        expect(await deviceService.releaseManualHold(UDID, HOST, HOLD)).to.equal(false);
        expect((await row()).session_id).to.equal(bobs);
        // Whose it is unknown (a recording's end): any manual hold.
        expect(await deviceService.releaseManualHold(UDID, HOST)).to.equal(true);
        expect((await row()).busy).to.equal(false);
      });
    });
  }

  describe('the idle sweeper and the reconciler (Prisma)', () => {
    usePrismaStores();

    it("a claim taken between the store's own read and its write keeps the phone", async () => {
      const claimedAt = Date.now() - 1_000;
      await seed({ busy: true, claimedAt });
      const s = store();
      const client = (s as any).prisma;
      let claimed = false;
      // The store's read, then a session's claim, then the store's write.
      const racingFind = async (args: any) => {
        const found = await client.device.findUnique(args);
        if (!claimed) {
          claimed = true;
          await client.device.updateMany({
            where: { udid: UDID, host: HOST },
            data: { claimedAt: null },
          });
          found.claimedAt = null;
          await s.claimForSession(UDID, HOST, null, SESSION, { session_id: SESSION });
        }
        return found;
      };
      const device = new Proxy(client.device, {
        get: (target, key) => (key === 'findUnique' ? racingFind : target[key]),
      });
      Object.defineProperty(s, 'prisma', {
        configurable: true,
        get: () => new Proxy(client, { get: (t, k) => (k === 'device' ? device : t[k]) }),
      });
      try {
        // Its first look found a phone free of claims; its write found the
        // claim and looked again.
        expect(await s.takeManualHold(UDID, HOST, HOLD)).to.equal(false);
      } finally {
        delete (s as any).prisma;
      }

      const after = await row();
      expect(after.claimSessionId).to.equal(SESSION);
      expect(after.session_id).to.equal(SESSION);
    });

    it('never releases a preview hold, even one carrying a stale clock', async () => {
      await seed({ busy: true, session_id: HOLD, lastCmdExecutedAt: Date.now() - HOUR });

      await releaseBlockedDevices(60);

      const after = await row();
      expect(after.session_id).to.equal(HOLD);
      expect(after.busy).to.equal(true);
    });

    it('after a lease, the next preview hold survives the sweep', async () => {
      // The lease's stamps, then its lock ends (LeaseService), then a preview.
      const stamp = Date.now() - HOUR;
      await seed({ busy: true, lastCmdExecutedAt: stamp, sessionStartTime: stamp });
      await store().releaseLeaseLock(UDID, HOST);
      await deviceService.blockDevice(UDID, HOST, HOLD);

      await releaseBlockedDevices(60);
      await Container.get(DeviceReconciler).reconcile();

      const after = await row();
      expect(after.session_id).to.equal(HOLD);
      expect(after.busy).to.equal(true);
    });

    it('the reconciler leaves a preview hold alone, whatever its sessionStartTime', async () => {
      await seed({ busy: true, session_id: HOLD, sessionStartTime: Date.now() - HOUR });
      await Container.get(DeviceReconciler).reconcile();
      expect((await row()).session_id).to.equal(HOLD);
    });

    it('a preview hold released when its last viewer goes keeps the claim beside it', async () => {
      const claimedAt = Date.now() - 1_000;
      await seed({ busy: true, claimedAt, claimSessionId: SESSION, session_id: HOLD });
      sinon.stub(ownDeviceRow, 'findOwnDevice').callsFake(async () => row());
      const real = Container.get.bind(Container);
      sinon.stub(Container, 'get').callsFake((token: any) => {
        if (token === AndroidH264StreamService) return { getMultiplexer: () => undefined } as any;
        if (token === AndroidStreamService)
          return { getStreamStatus: () => ({ viewerCount: 0 }) } as any;
        if (token === RecordingStore) return { isRecording: async () => false } as any;
        return real(token);
      });

      expect(await releaseIdlePreviewHold(UDID)).to.equal(true);
      sinon.restore();

      const after = await row();
      expect(after.session_id ?? null).to.equal(null);
      expect(after.claimSessionId).to.equal(SESSION);
      expect(after.busy).to.equal(true);
    });
  });

  describe('a command longer than the new-command timeout (Prisma)', () => {
    usePrismaStores();
    const pluginArgs = { ...DefaultPluginArgs, enableDashboard: false } as IPluginArgs;
    const driver = { sessionId: SESSION, caps: { udid: UDID } };

    afterEach(() => Container.get(AutowaitService).clearSession(SESSION));

    it("keeps the session's phone while the command runs, and counts the timeout from its end", async () => {
      await seed({
        busy: true,
        claimedAt: Date.now(),
        claimSessionId: SESSION,
        session_id: SESSION,
        newCommandTimeout: 60,
        lastCmdExecutedAt: Date.now(),
      });
      let finish: (value: unknown) => void = () => {};
      const next = () => new Promise((resolve) => (finish = resolve));
      const command = new CommandInterceptor().handle(
        next,
        driver,
        'getPageSource',
        [SESSION],
        pluginArgs,
        false,
      );
      await until(async () => (await row()).lastCmdExecutedAt != null);
      // The command has run for over an hour by now.
      await store().updateDevice(UDID, HOST, { lastCmdExecutedAt: Date.now() - HOUR });

      await releaseBlockedDevices(60);
      const during = await row();
      expect(during.claimSessionId, 'claimed while its command runs').to.equal(SESSION);
      expect(during.busy).to.equal(true);

      const ended = Date.now();
      finish('<xml/>');
      expect(await command).to.equal('<xml/>');
      await until(async () => ((await row()).lastCmdExecutedAt ?? 0) >= ended);

      await releaseBlockedDevices(60);
      expect((await row()).claimSessionId, 'not idle just after its command').to.equal(SESSION);
    });

    it('a command that fails touches the clock at its end too', async () => {
      await seed({
        busy: true,
        claimedAt: Date.now(),
        claimSessionId: SESSION,
        session_id: SESSION,
        lastCmdExecutedAt: 1,
      });
      let fail: (error: Error) => void = () => {};
      const next = () => new Promise((_resolve, reject) => (fail = reject));
      const command = new CommandInterceptor().handle(
        next,
        driver,
        'getPageSource',
        [SESSION],
        pluginArgs,
        false,
      );
      await until(async () => ((await row()).lastCmdExecutedAt ?? 0) > 1);
      await store().updateDevice(UDID, HOST, { lastCmdExecutedAt: 1 });

      fail(new Error('the driver gave up'));
      await command.then(
        () => expect.fail('the command succeeded'),
        (e: Error) => expect(e.message).to.equal('the driver gave up'),
      );
      await until(async () => ((await row()).lastCmdExecutedAt ?? 0) > 1);
    });
  });

  describe('a command a hub forwards (Prisma)', () => {
    usePrismaStores();
    const loopback = loopbackServers();
    afterEach(() => loopback.closeAll());

    it("touches the session's clock at both ends, and the sweeper leaves the phone meanwhile", async () => {
      await seed({
        busy: true,
        claimedAt: Date.now(),
        claimSessionId: SESSION,
        session_id: SESSION,
        lastCmdExecutedAt: Date.now(),
      });
      let answer = () => {};
      const node = express();
      node.get('/wd/hub/session/:id/source', (_req, res) => {
        answer = () => res.json({ value: '<xml/>' });
      });
      const nodeServer = await loopback.serve(node);
      const nodeUrl = `http://127.0.0.1:${(nodeServer.address() as any).port}/wd/hub`;

      const touched: number[] = [];
      const routing = createHubRouting({
        basePath: '/wd/hub',
        locate: async () => ({ kind: 'remote', url: nodeUrl, cloud: false, session: {} as any }),
        forget: () => undefined,
        tokenFor: async () => null,
        forgetToken: () => undefined,
        deleteSession: async (next) => next(),
        touch: async (sessionId) => {
          touched.push(Date.now());
          await deviceService.updateCmdExecutedTime(sessionId);
        },
        commandName: () => 'getPageSource',
        logger: { warn: () => undefined, error: () => undefined, info: () => undefined } as any,
      });
      const hub = express();
      hub.use(express.json());
      hub.use(
        '/wd/hub/session/:sessionId',
        createSessionGatewayLayer({
          auth: {
            enabled: () => false,
            authDisabled: () => true,
            verifier: { verify: async () => ({ ok: false }) as any },
            ownerOf: async () => null,
            ownersOf: async () => new Map(),
            logger: { warn: () => undefined, error: () => undefined, info: () => undefined } as any,
          },
          routing,
        }),
      );
      const hubServer = await loopback.serve(hub);
      const hubUrl = `http://127.0.0.1:${(hubServer.address() as any).port}`;

      const sent = request(hubUrl)
        .get(`/wd/hub/session/${SESSION}/source`)
        .then((r) => r);
      await until(() => touched.length === 1);
      await store().updateDevice(UDID, HOST, { lastCmdExecutedAt: Date.now() - HOUR });

      await releaseBlockedDevices(60);
      expect((await row()).claimSessionId, 'claimed while forwarded').to.equal(SESSION);

      answer();
      const res = await sent;
      expect(res.status).to.equal(200);
      await until(() => touched.length === 2);
      await until(async () => ((await row()).lastCmdExecutedAt ?? 0) > Date.now() - 60_000);
    });
  });
});
