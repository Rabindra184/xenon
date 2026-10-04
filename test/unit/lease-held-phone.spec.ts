import 'reflect-metadata';
import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import * as ActiveLeases from '../../src/services/lease/activeLeases';
import * as DeviceUtils from '../../src/device-utils';
import * as DeviceService from '../../src/data-service/device-service';
import { XenonDatabase } from '../../src/data-service/db';
import { addNewDevice } from '../../src/data-service/device-service';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';
import {
  createTestXenonManager,
  setupTestContainer,
  resetTestContainer,
} from '../helpers/test-container';
import { useLokiStores } from '../helpers/loki-stores';
import { useScratchDatabase } from '../helpers/scratch-database';

chai.use(sinonChai);
const expect = chai.expect;

// A phone an SDK lease holds stays its lease's until the lease ends. Its only
// lock is `busy`, and three things used to undo that: the idle sweeper (which
// read the lease's creation as the phone's last command), a lease-bound
// session's release, and allocation, which offered only the first candidate
// to the lock and so stalled on a leased phone while others were free.

describe('a phone an SDK lease holds', () => {
  useLokiStores();
  const scratch = useScratchDatabase();
  const sandbox = sinon.createSandbox();

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
      host: 'http://127.0.0.1:4723',
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

  const lease = (udid: string, over: Record<string, unknown> = {}) =>
    scratch.db.lease.create({
      data: {
        tokenHash: 'h',
        deviceUdid: udid,
        deviceHost: 'http://127.0.0.1:4723',
        actorId: 'key_owner',
        status: 'active',
        expiresAt: Date.now() + 600_000,
        lastHeartbeatAt: Date.now(),
        allocatedPorts: '{}',
        capabilityBag: '{}',
        ...over,
      },
    });

  const row = async (udid: string): Promise<IDevice> =>
    (await XenonDatabase.DeviceModel).findOne({ udid });

  const setRow = async (udid: string, fields: Partial<IDevice>) =>
    (await XenonDatabase.DeviceModel)
      .chain()
      .find({ udid })
      .update((d: IDevice) => Object.assign(d, fields));

  before(async () => {
    await resetTestContainer();
    await setupTestContainer();
  });

  after(() => resetTestContainer());

  beforeEach(async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    await scratch.db.lease.deleteMany({});
    createTestXenonManager(Object.assign({}, pluginArgs, { maxSessions: 10, platform: 'android' }));
    sandbox.stub(DeviceUtils, 'setUtilizationTime' as any).resolves();
  });

  afterEach(() => sandbox.restore());

  describe('the idle sweeper', () => {
    const idle = { busy: true, lastCmdExecutedAt: Date.now() - 600_000 };

    it('leaves a leased phone with no session alone', async () => {
      await addNewDevice([phone('leased-1')]);
      await setRow('leased-1', idle);
      await lease('leased-1');
      const unblock = sandbox.spy(DeviceService, 'unblockDevice');

      await DeviceUtils.releaseBlockedDevices(20);

      expect(unblock).not.to.have.been.called;
      expect((await row('leased-1')).busy).to.equal(true);
    });

    it('frees it once the lease has lapsed', async () => {
      await addNewDevice([phone('lapsed-1')]);
      await setRow('lapsed-1', idle);
      await lease('lapsed-1', { expiresAt: Date.now() - 1_000 });
      const unblock = sandbox.spy(DeviceService, 'unblockDevice');

      await DeviceUtils.releaseBlockedDevices(20);

      expect(unblock).to.have.been.calledWith('lapsed-1');
    });

    it('skips its tick when it cannot tell which phones are leased', async () => {
      // Failing open would free every leased phone: their last command is
      // when the lease was taken.
      await addNewDevice([phone('plain-3')]);
      await setRow('plain-3', idle);
      sandbox.stub(ActiveLeases, 'activeLeasesByDevice').rejects(new Error('db down'));
      const unblock = sandbox.spy(DeviceService, 'unblockDevice');

      await DeviceUtils.releaseBlockedDevices(20);

      expect(unblock).not.to.have.been.called;
    });

    it('still frees an idle phone nobody leases', async () => {
      await addNewDevice([phone('plain-1')]);
      await setRow('plain-1', idle);
      const unblock = sandbox.spy(DeviceService, 'unblockDevice');

      await DeviceUtils.releaseBlockedDevices(20);

      expect(unblock).to.have.been.calledWith('plain-1');
    });
  });

  describe("a lease-bound session's release", () => {
    it('hands the phone back to the lease, still busy', async () => {
      await addNewDevice([phone('leased-2')]);
      await setRow('leased-2', { busy: true, session_id: 'sess-1' });
      await lease('leased-2');

      expect(
        await DeviceService.releaseSessionDevice('leased-2', 'http://127.0.0.1:4723', 'sess-1'),
      ).to.be.true;

      const after = await row('leased-2');
      expect(after.session_id ?? null).to.equal(null);
      expect(after.busy).to.equal(true);
    });

    it('undoes the hand-back when the lease ended meanwhile', async () => {
      await addNewDevice([phone('racing-1')]);
      await setRow('racing-1', { busy: true, session_id: 'sess-3' });
      // Live at the first check, gone by the second.
      const lookup = sandbox.stub(ActiveLeases, 'activeLeaseOn');
      lookup.onFirstCall().resolves({ id: 'l', actorId: 'k' } as any);
      lookup.resolves(null);

      await DeviceService.releaseSessionDevice('racing-1', 'http://127.0.0.1:4723', 'sess-3');

      expect(lookup).to.have.been.calledTwice;
      expect((await row('racing-1')).busy).to.equal(false);
    });

    it('frees a phone with no lease, as before', async () => {
      await addNewDevice([phone('plain-2')]);
      await setRow('plain-2', { busy: true, session_id: 'sess-2' });

      await DeviceService.releaseSessionDevice('plain-2', 'http://127.0.0.1:4723', 'sess-2');

      expect((await row('plain-2')).busy).to.equal(false);
    });
  });

  describe('allocation for a session', () => {
    const caps = (udid?: string) => ({
      alwaysMatch: {
        platformName: 'android',
        ...(udid ? { 'appium:udid': udid } : {}),
      },
      firstMatch: [{}],
    });

    it("never locks a reserved phone's twin on another host in its place", async () => {
      // Same udid on two hosts: the reserved row is listed first.
      await addNewDevice([
        phone('twin', {
          host: 'http://other:4723',
          reservedUntil: Date.now() + 600_000,
          reservedBy: 'x',
        }),
        phone('twin'),
      ]);

      const got = await DeviceUtils.allocateDeviceForSession(caps() as any, 2_000, 100, pluginArgs);

      expect(got.host).to.equal('http://127.0.0.1:4723');
      const reserved = (await XenonDatabase.DeviceModel).findOne({
        udid: 'twin',
        host: 'http://other:4723',
      });
      expect(reserved.busy).to.equal(false);
    });

    it('skips a leased phone whose busy flag was cleared and takes a free one', async () => {
      // Listed first, so the old single-candidate lock tried only it, forever.
      await addNewDevice([phone('a-leased'), phone('b-free')]);
      await lease('a-leased');

      const got = await DeviceUtils.allocateDeviceForSession(caps() as any, 2_000, 100, pluginArgs);

      expect(got.udid).to.equal('b-free');
    });
  });
});
