import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { allocateDeviceForSession } from '../../../src/device-utils';
import { addNewDevice } from '../../../src/data-service/device-service';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { serverOrigin } from '../../../src/device-managers/localDeviceHosts';
import IOSStreamService from '../../../src/device-managers/ios/IOSStreamService';
import { WDAClient } from '../../../src/device-managers/ios/WDAClient';
import { DefaultPluginArgs, IPluginArgs } from '../../../src/interfaces/IPluginArgs';
import { IDevice } from '../../../src/interfaces/IDevice';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { resetTestContainer, setupTestContainer } from '../../helpers/test-container';
import { usePrismaStores } from '../../helpers/loki-stores';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { saveRegistrations } from '../../helpers/container-registration';

/**
 * A session on a leased phone is allocated through the lease branch, which
 * returned before the readiness check every other session goes through. For
 * this server's own iPhone that check is what asks WebDriverAgent and, when
 * it doesn't answer, starts the go-ios stream whose WebDriverAgent the
 * session then uses. Without it a leased iPhone's session had no
 * WebDriverAgent unless someone happened to be previewing the phone, and the
 * driver fell back to building one with xcodebuild.
 */
describe('Readiness before a session on a leased phone', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  usePrismaStores();

  const UDID = '00008150-000E78612168C01C';
  const LEASE = 'lse_ready';
  const pluginArgs: IPluginArgs = { ...DefaultPluginArgs, platform: 'ios', iosDeviceType: 'both' };

  let ownNodeId: string;
  let ownHost: string;
  let verifyWda: sinon.SinonStub;
  let startStream: sinon.SinonStub;
  let authorize: sinon.SinonStub;
  let restoreLeaseService: () => void;

  const iPhone = (over: Partial<IDevice>) =>
    ({
      udid: UDID,
      name: 'iPhone 17 Pro Max',
      platform: 'ios',
      sdk: '27.2',
      deviceType: 'real',
      realDevice: true,
      state: 'device',
      busy: true,
      offline: false,
      userBlocked: false,
      wdaLocalPort: 8100,
      mjpegServerPort: 9100,
      totalUtilizationTimeMilliSec: 0,
      sessionStartTime: 0,
      ...over,
    }) as unknown as IDevice;

  const caps = () =>
    ({
      alwaysMatch: { platformName: 'iOS', 'xe:options': { leaseId: LEASE } },
      firstMatch: [{}],
    }) as any;

  const allocate = () =>
    allocateDeviceForSession(caps(), 1_000, 50, pluginArgs, undefined, {
      canOverride: false,
      apiKeyId: null,
      userId: null,
      leaseToken: 'token',
    });

  const refusal = () =>
    allocate().then(
      () => null,
      (e: Error) => e,
    );

  const leaseOn = (host: string) =>
    authorize.resolves({ id: LEASE, deviceUdid: UDID, deviceHost: host, capabilityBag: '{}' });

  const row = (host: string) => DeviceStoreFactory.getStore().findDevice({ udid: UDID, host });

  beforeEach(async () => {
    const { context, xenonManager } = setupTestContainer(pluginArgs);
    xenonManager.init();
    ownNodeId = context.nodeId;
    ownHost = serverOrigin(context.pluginArgs, context.port);
    await scratch.db.device.deleteMany({});
    await scratch.db.deviceSetting.deleteMany({});
    verifyWda = sinon.stub(WDAClient.prototype, 'verifyWDAStatus');
    startStream = sinon.stub(IOSStreamService.prototype, 'startStream');
    authorize = sinon.stub();
    restoreLeaseService = saveRegistrations(LeaseService);
    Container.set(LeaseService, { authorizeSessionUse: authorize } as any);
  });

  afterEach(async () => {
    sinon.restore();
    restoreLeaseService();
    await resetTestContainer();
  });

  describe("this server's own iPhone", () => {
    beforeEach(async () => {
      await addNewDevice([iPhone({ host: ownHost, nodeId: ownNodeId })]);
      leaseOn(ownHost);
    });

    it('is checked, and allocated when its WebDriverAgent answers', async () => {
      verifyWda.resolves(true);

      const device = await allocate();

      expect(device).to.include({ udid: UDID, host: ownHost });
      expect(verifyWda.calledWith(UDID)).to.equal(true);
    });

    it("starts the phone's stream when its WebDriverAgent doesn't answer", async () => {
      verifyWda.callsFake(async () => startStream.called);
      startStream.resolves({ wdaPort: 8100, mjpegPort: 9100 });

      const device = await allocate();

      expect(device).to.include({ udid: UDID, host: ownHost });
      expect(startStream.calledWith(UDID)).to.equal(true);
    });

    it('is refused when it is not ready and cannot be recovered, and stays the lease’s', async () => {
      verifyWda.resolves(false);
      startStream.rejects(new Error('go-ios could not start'));

      const error = await refusal();

      expect(error?.message).to.match(/is unhealthy and could not be autonomously recovered/);
      // The lease still holds the phone: no session claimed it, so nothing
      // is released for the session that didn't start.
      expect((await row(ownHost))?.busy).to.equal(true);
    });
  });

  it("never checks another server's phone: its server does when the session reaches it", async () => {
    const NODE = 'http://203.0.113.7:4723';
    await addNewDevice([iPhone({ host: NODE, nodeId: 'node-process' })]);
    leaseOn(NODE);
    verifyWda.resolves(false);
    startStream.rejects(new Error(`Device ${UDID} not found`));

    const device = await allocate();

    expect(device).to.include({ udid: UDID, host: NODE });
    expect(verifyWda.called, 'verifyWDAStatus called').to.equal(false);
    expect(startStream.called, 'startStream called').to.equal(false);
  });

  it('checks nothing for a session that may not use the lease', async () => {
    await addNewDevice([iPhone({ host: ownHost, nodeId: ownNodeId })]);
    authorize.resolves(null);

    const error = await refusal();

    expect(error?.message).to.match(/^lease lse_ready is not active/);
    expect(verifyWda.called, 'verifyWDAStatus called').to.equal(false);
    expect(startStream.called, 'startStream called').to.equal(false);
  });
});
