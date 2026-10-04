import 'reflect-metadata';
import chai from 'chai';
import sinon from 'sinon';
import * as DeviceUtils from '../../src/device-utils';
import { XenonDatabase } from '../../src/data-service/db';
import { addNewDevice } from '../../src/data-service/device-service';
import { countsTowardMaxSessions, sessionCap } from '../../src/data-service/deviceClaims';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';
import {
  createTestXenonManager,
  setupTestContainer,
  resetTestContainer,
} from '../helpers/test-container';
import { useLokiStores } from '../helpers/loki-stores';
import { useScratchDatabase } from '../helpers/scratch-database';

const expect = chai.expect;

/**
 * `maxSessions` holds new sessions back once that many Appium sessions run.
 *
 * It compared the number of busy phones with `===`, so once the count was past
 * the limit nothing was held back any more, and it counted every busy phone: a
 * live preview, a recording, or an SDK lease nobody had started a session on
 * used up a slot that no Appium session was using. What it counts now is the
 * phones running a session, or being given one.
 */
describe('maxSessions', () => {
  describe('which phones count', () => {
    const base = { busy: true } as Partial<IDevice>;

    it('counts a session being created (a claim with no session id yet)', () => {
      expect(countsTowardMaxSessions({ ...base, claimedAt: Date.now() })).to.equal(true);
    });

    it('counts a session that is running', () => {
      expect(
        countsTowardMaxSessions({
          ...base,
          claimedAt: 1,
          claimSessionId: 'sess-1',
          session_id: 'sess-1',
        }),
      ).to.equal(true);
      expect(countsTowardMaxSessions({ ...base, session_id: 'sess-1' })).to.equal(true);
    });

    it('does not count a live preview or a recording', () => {
      expect(countsTowardMaxSessions({ ...base, session_id: 'manual_u1_phone-1' })).to.equal(false);
      expect(countsTowardMaxSessions({ ...base, session_id: 'manual_phone-1' })).to.equal(false);
    });

    it('does not count a phone an SDK lease holds that has no session on it', () => {
      expect(countsTowardMaxSessions({ ...base })).to.equal(false);
    });

    it('counts a session started on a leased phone', () => {
      expect(countsTowardMaxSessions({ ...base, claimSessionId: 'sess-2', claimedAt: 1 })).to.equal(
        true,
      );
    });

    it('does not count a phone that is not busy', () => {
      expect(countsTowardMaxSessions({ busy: false })).to.equal(false);
      expect(countsTowardMaxSessions({ busy: false, session_id: 'sess-1' })).to.equal(false);
    });

    it("counts a node's phone the node reports busy, unless the node says it is a preview", () => {
      expect(countsTowardMaxSessions({ ...base, nodeBusy: true })).to.equal(true);
      expect(
        countsTowardMaxSessions({ ...base, nodeBusy: true, nodeHold: 'manual_u1_phone-1' }),
      ).to.equal(false);
    });
  });

  describe('the limit itself', () => {
    it('is the setting when it is a positive number', () => {
      expect(sessionCap(8)).to.equal(8);
      expect(sessionCap(1)).to.equal(1);
    });

    it('is no limit when it is unset, zero, negative or not a number', () => {
      for (const value of [undefined, null, 0, -1, NaN, Infinity, '8' as any]) {
        expect(sessionCap(value as any), String(value)).to.equal(undefined);
      }
    });
  });

  describe('allocation', () => {
    useLokiStores();
    const scratch = useScratchDatabase();
    const sandbox = sinon.createSandbox();
    const HOST = 'http://127.0.0.1:4723';

    const pluginArgs = Object.assign({}, DefaultPluginArgs, {
      iosDeviceType: 'both',
      androidDeviceType: 'both',
    });

    const phone = (udid: string, over: Partial<IDevice> = {}) =>
      ({
        udid,
        name: udid,
        platform: 'android',
        sdk: '13',
        host: HOST,
        busy: false,
        offline: false,
        userBlocked: false,
        state: 'device',
        deviceType: 'emulator',
        realDevice: false,
        systemPort: 57000,
        totalUtilizationTimeMilliSec: 0,
        sessionStartTime: 0,
        ...over,
      }) as unknown as IDevice;

    // New each time: allocation pins the phone it picked into the caps it is given.
    const caps = () => ({
      alwaysMatch: { platformName: 'android' },
      firstMatch: [{}],
    });

    const row = async (udid: string): Promise<IDevice> =>
      (await XenonDatabase.DeviceModel).findOne({ udid });

    /** Asks for a phone, waiting `ms` at most. Resolves to the udid, or null when held back. */
    const ask = (ms = 400) =>
      DeviceUtils.allocateDeviceForSession(caps() as any, ms, 50, pluginArgs).then(
        (d) => d.udid,
        () => null,
      );

    const withCap = (maxSessions: number) =>
      createTestXenonManager(Object.assign({}, pluginArgs, { maxSessions, platform: 'android' }));

    before(async () => {
      await resetTestContainer();
      await setupTestContainer();
    });
    after(() => resetTestContainer());

    beforeEach(async () => {
      (await XenonDatabase.DeviceModel).removeDataOnly();
      await scratch.db.lease.deleteMany({});
      sandbox.stub(DeviceUtils, 'setUtilizationTime' as any).resolves();
    });
    afterEach(() => sandbox.restore());

    const running = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        phone(`running-${i}`, {
          busy: true,
          session_id: `sess-${i}`,
          claimSessionId: `sess-${i}`,
          claimedAt: 1,
        }),
      );

    it('allocates while fewer sessions run than the limit', async () => {
      withCap(2);
      await addNewDevice([...running(1), phone('free-1')]);

      expect(await ask()).to.equal('free-1');
    });

    it('holds a session back at the limit', async () => {
      withCap(2);
      await addNewDevice([...running(2), phone('free-1')]);

      expect(await ask()).to.equal(null);
      expect((await row('free-1')).busy).to.equal(false);
    });

    it('still holds it back when more sessions run than the limit, which `===` let through', async () => {
      withCap(2);
      await addNewDevice([...running(3), phone('free-1')]);

      expect(await ask()).to.equal(null);
      expect((await row('free-1')).busy).to.equal(false);
    });

    it('gives the phone once a session ends', async () => {
      withCap(2);
      await addNewDevice([...running(2), phone('free-1')]);
      const waiting = ask(2_000);
      await new Promise((r) => setTimeout(r, 150));
      (await XenonDatabase.DeviceModel)
        .chain()
        .find({ udid: 'running-0' })
        .update((d: IDevice) =>
          Object.assign(d, {
            busy: false,
            session_id: null,
            claimSessionId: null,
            claimedAt: null,
          }),
        );

      expect(await waiting).to.be.oneOf(['free-1', 'running-0']);
    });

    it('does not count live previews: they are not sessions', async () => {
      withCap(2);
      await addNewDevice([
        phone('preview-1', { busy: true, session_id: 'manual_u1_preview-1' }),
        phone('preview-2', { busy: true, session_id: 'manual_u1_preview-2' }),
        phone('free-1'),
      ]);

      expect(await ask()).to.equal('free-1');
    });

    it('does not count a leased phone no session is running on', async () => {
      withCap(1);
      await addNewDevice([phone('leased-1', { busy: true }), phone('free-1')]);
      await scratch.db.lease.create({
        data: {
          tokenHash: 'h',
          deviceUdid: 'leased-1',
          deviceHost: HOST,
          actorId: 'key_owner',
          status: 'active',
          expiresAt: Date.now() + 600_000,
          lastHeartbeatAt: Date.now(),
          allocatedPorts: '{}',
          capabilityBag: '{}',
        },
      });

      expect(await ask()).to.equal('free-1');
    });

    it('counts a session started on a leased phone', async () => {
      withCap(1);
      await addNewDevice([
        phone('leased-1', {
          busy: true,
          session_id: 'sess-l',
          claimSessionId: 'sess-l',
          claimedAt: 1,
        }),
        phone('free-1'),
      ]);

      expect(await ask()).to.equal(null);
    });

    it('counts a session still being created', async () => {
      withCap(1);
      await addNewDevice([
        phone('pending-1', { busy: true, claimedAt: Date.now() }),
        phone('free-1'),
      ]);

      expect(await ask()).to.equal(null);
    });

    it('holds back exactly the sessions over the limit when many ask at once', async () => {
      withCap(2);
      await addNewDevice(Array.from({ length: 6 }, (_, i) => phone(`free-${i}`)));

      const got = await Promise.all(Array.from({ length: 5 }, () => ask(300)));

      const given = got.filter((udid) => udid !== null);
      expect(given, JSON.stringify(got)).to.have.length(2);
      expect(new Set(given).size).to.equal(2);
    });

    it('has no limit when the setting is not a positive number', async () => {
      withCap(0);
      await addNewDevice([...running(3), phone('free-1')]);

      expect(await ask()).to.equal('free-1');
    });
  });
});
