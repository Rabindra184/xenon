import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { allocateDeviceForSession } from '../../src/device-utils';
import { addNewDevice } from '../../src/data-service/device-service';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { serverOrigin } from '../../src/device-managers/localDeviceHosts';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { WDAClient } from '../../src/device-managers/ios/WDAClient';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';
import { resetTestContainer, setupTestContainer } from '../helpers/test-container';
import { usePrismaStores } from '../helpers/loki-stores';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * Before a session, allocation asks the phone's manager whether it is ready.
 * For an iPhone that asks WebDriverAgent on 127.0.0.1, at the port the phone's
 * row names, and on no answer starts a go-ios stream for the phone. Both are
 * this machine's: they say nothing about a phone another server drives.
 *
 * A hub ran it for its nodes' iPhones too. With the node on another machine
 * nothing answered on the hub, its stream found no phone of its own to start,
 * and every session on the node's iPhone was refused as "unhealthy". With both
 * on one Mac, the hub started its own WebDriverAgent on the phone the node
 * drives. The node checks the phone itself when it allocates it.
 */
describe("Readiness before a session, on a hub allocating a node's iPhone", function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  usePrismaStores();

  const NODE_ID = 'node-process';
  const UDID = '00008110-000A1B2C3D4E5F60';
  const pluginArgs: IPluginArgs = {
    ...DefaultPluginArgs,
    platform: 'ios',
    iosDeviceType: 'both',
  };

  let hubNodeId: string;
  let hubOrigin: string;
  let verifyWda: sinon.SinonStub;
  let startStream: sinon.SinonStub;

  const iPhone = (over: Partial<IDevice>) =>
    ({
      udid: UDID,
      name: 'iPhone 14 Plus',
      platform: 'ios',
      sdk: '18.0',
      deviceType: 'real',
      realDevice: true,
      state: 'device',
      busy: false,
      offline: false,
      userBlocked: false,
      wdaLocalPort: 8100,
      mjpegServerPort: 9100,
      totalUtilizationTimeMilliSec: 0,
      sessionStartTime: 0,
      ...over,
    }) as unknown as IDevice;

  const caps = (extra: Record<string, unknown> = {}) =>
    ({
      alwaysMatch: { platformName: 'iOS', 'appium:udid': UDID, ...extra },
      firstMatch: [{}],
    }) as any;

  const allocate = (extra: Record<string, unknown> = {}) =>
    allocateDeviceForSession(caps(extra), 1_000, 50, pluginArgs);

  const row = (host: string) => DeviceStoreFactory.getStore().findDevice({ udid: UDID, host });

  beforeEach(async () => {
    const { context, xenonManager } = setupTestContainer(pluginArgs);
    xenonManager.init();
    hubNodeId = context.nodeId;
    hubOrigin = serverOrigin(context.pluginArgs, context.port);
    await scratch.db.device.deleteMany({});
    await scratch.db.deviceSetting.deleteMany({});
    verifyWda = sinon.stub(WDAClient.prototype, 'verifyWDAStatus');
    startStream = sinon.stub(IOSStreamService.prototype, 'startStream');
  });

  afterEach(async () => {
    sinon.restore();
    await resetTestContainer();
  });

  describe('a node on another machine', () => {
    const NODE = 'http://203.0.113.7:4723';

    beforeEach(() => {
      // What the hub's own machine answers: no WebDriverAgent on its
      // 127.0.0.1, and no row of its own to start a stream from.
      verifyWda.resolves(false);
      startStream.rejects(new Error(`Device ${UDID} not found`));
    });

    it("allocates the node's iPhone, which the node checks itself", async () => {
      await addNewDevice([iPhone({ host: NODE, nodeId: NODE_ID })]);

      const device = await allocate();

      expect(device).to.include({ udid: UDID, host: NODE });
      expect((await row(NODE))?.busy).to.equal(true);
    });

    it("never asks the hub's own WebDriverAgent or starts a stream for it", async () => {
      await addNewDevice([iPhone({ host: NODE, nodeId: NODE_ID })]);

      await allocate().catch(() => undefined);

      expect(verifyWda.called, 'verifyWDAStatus called').to.equal(false);
      expect(startStream.called, 'startStream called').to.equal(false);
    });
  });

  describe('a node on the same Mac', () => {
    it("never starts the hub's own stream for the iPhone the node drives", async () => {
      const node = `http://${pluginArgs.bindHostOrIp}:4724`;
      // The hub sees the same iPhone and files it under its own host; the
      // client asks for the node's.
      await addNewDevice([
        iPhone({ host: node, nodeId: NODE_ID }),
        iPhone({ host: hubOrigin, nodeId: hubNodeId, wdaLocalPort: 8101 }),
      ]);
      // The hub's stream starts for the udid, and its WebDriverAgent then
      // answers: a second one beside the node's.
      verifyWda.callsFake(async () => startStream.called);
      startStream.resolves({ wdaPort: 8102, mjpegPort: 9102 });

      const device = await allocate({ 'appium:filterByHost': node });

      expect(device).to.include({ udid: UDID, host: node });
      expect(startStream.called, 'startStream called').to.equal(false);
      expect(verifyWda.called, 'verifyWDAStatus called').to.equal(false);
      expect((await row(hubOrigin))?.busy).to.equal(false);
    });
  });

  describe("the hub's own iPhone", () => {
    it('is still checked, and allocated when its WebDriverAgent answers', async () => {
      await addNewDevice([iPhone({ host: hubOrigin, nodeId: hubNodeId })]);
      verifyWda.resolves(true);

      const device = await allocate();

      expect(device).to.include({ udid: UDID, host: hubOrigin });
      expect(verifyWda.calledWith(UDID)).to.equal(true);
    });

    it('is still refused, and released, when it is not ready and cannot be recovered', async () => {
      await addNewDevice([iPhone({ host: hubOrigin, nodeId: hubNodeId })]);
      verifyWda.resolves(false);
      startStream.rejects(new Error('go-ios could not start'));

      const error = await allocate().then(
        () => null,
        (e: Error) => e,
      );

      expect(error?.message).to.match(/is unhealthy and could not be autonomously recovered/);
      expect(startStream.calledWith(UDID)).to.equal(true);
      expect((await row(hubOrigin))?.busy).to.equal(false);
    });
  });
});
