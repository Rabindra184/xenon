import 'reflect-metadata';
import chai from 'chai';
import sinon from 'sinon';
import { Simctl } from 'node-simctl';
import * as DeviceUtils from '../../src/device-utils';
import { XenonDatabase } from '../../src/data-service/db';
import { addNewDevice } from '../../src/data-service/device-service';
import IOSDeviceManager from '../../src/device-managers/IOSDeviceManager';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { WDAClient } from '../../src/device-managers/ios/WDAClient';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';
import { createTestXenonManager, resetTestContainer } from '../helpers/test-container';
import { useLokiStores } from '../helpers/loki-stores';
import { useScratchDatabase } from '../helpers/scratch-database';

const expect = chai.expect;

/**
 * A simulator's WebDriverAgent is the XCUITest driver's: the driver builds,
 * installs and launches it on the session's `wdaLocalPort` once Appium
 * creates the session, as plain Appium does. Xenon runs WDA only on an
 * iPhone (go-ios `runwda`, for the live preview).
 *
 * Allocation used to require WDA to answer on the simulator's port before
 * handing it over, and to "recover" it by rebooting the simulator, which
 * starts no WDA. So every session on a simulator whose WDA wasn't already up
 * was refused: "Device <udid> is unhealthy and could not be autonomously
 * recovered."
 */
describe('iOS simulator sessions: the driver starts WebDriverAgent', () => {
  useLokiStores();
  const scratch = useScratchDatabase();
  const sandbox = sinon.createSandbox();
  const HOST = 'http://127.0.0.1:4723';
  const SIMULATOR = '35429994-B029-4AF4-9634-880B89DAC782';
  const IPHONE = '00008150-000E78612168C01C';

  const pluginArgs = Object.assign({}, DefaultPluginArgs, {
    platform: 'ios',
    iosDeviceType: 'both',
  });

  const device = (udid: string, over: Partial<IDevice> = {}) =>
    ({
      udid,
      name: 'iPhone 16 Pro',
      platform: 'ios',
      sdk: '18.4',
      host: HOST,
      busy: false,
      offline: false,
      userBlocked: false,
      state: 'Booted',
      deviceType: 'simulator',
      realDevice: false,
      // Leased by discovery for a booted simulator; nothing listens on it
      // until the driver launches WDA there.
      wdaLocalPort: 8102,
      mjpegServerPort: 9102,
      totalUtilizationTimeMilliSec: 0,
      sessionStartTime: 0,
      ...over,
    }) as unknown as IDevice;

  let wdaAsked: sinon.SinonStub;
  let simctlCommands: string[];

  before(() => resetTestContainer());
  after(() => resetTestContainer());

  beforeEach(async () => {
    sandbox.stub(process, 'kill');
    (await XenonDatabase.DeviceModel).removeDataOnly();
    await scratch.db.lease.deleteMany({});
    sandbox.stub(DeviceUtils, 'setUtilizationTime' as any).resolves();
    sandbox.stub(IOSStreamService.prototype, 'getStreamStatus').returns(undefined);
    // Nothing answers on the simulator's port, as on a freshly booted one.
    wdaAsked = sandbox.stub(WDAClient.prototype, 'verifyWDAStatus').resolves(false);
    // Every simctl call (shutdown, boot, list) goes through exec.
    simctlCommands = [];
    sandbox.stub(Simctl.prototype, 'exec').callsFake(async (subcommand: string) => {
      simctlCommands.push(subcommand);
      return { stdout: '', stderr: '', code: 0 } as any;
    });
    createTestXenonManager(pluginArgs);
  });
  afterEach(() => sandbox.restore());

  const caps = (udid: string) => ({
    alwaysMatch: {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': udid,
    },
    firstMatch: [{}] as Record<string, any>[],
  });

  it('allocates a booted simulator whose WebDriverAgent is not running yet', async () => {
    await addNewDevice([device(SIMULATOR)]);
    const requested = caps(SIMULATOR);

    const allocated = await DeviceUtils.allocateDeviceForSession(
      requested as any,
      2_000,
      100,
      pluginArgs,
    );

    expect(allocated.udid).to.equal(SIMULATOR);
    expect(wdaAsked.called, 'asked WebDriverAgent').to.equal(false);
    expect(simctlCommands, 'rebooted the simulator').to.not.include('shutdown');
    expect(simctlCommands, 'rebooted the simulator').to.not.include('boot');
    // The driver gets the port to launch its own WDA on, and no URL of one.
    const fm = requested.firstMatch[0];
    expect(fm['appium:wdaLocalPort']).to.equal(8102);
    expect(fm).to.not.have.property('appium:webDriverAgentUrl');
  });

  it('allocates a shut-down simulator, which the driver boots', async () => {
    // Discovery leases no port to a shut-down simulator.
    await addNewDevice([
      device(SIMULATOR, { state: 'Shutdown', wdaLocalPort: undefined, mjpegServerPort: 9103 }),
    ]);
    const requested = caps(SIMULATOR);

    const allocated = await DeviceUtils.allocateDeviceForSession(
      requested as any,
      2_000,
      100,
      pluginArgs,
    );

    expect(allocated.udid).to.equal(SIMULATOR);
    expect(wdaAsked.called).to.equal(false);
    expect(simctlCommands).to.not.include('boot');
    // It gets one now, for the driver's WDA.
    expect(requested.firstMatch[0]['appium:wdaLocalPort']).to.be.a('number');
  });

  describe('an iPhone, whose WebDriverAgent Xenon runs', () => {
    const iphone = () => device(IPHONE, { realDevice: true, deviceType: 'real' });

    it('is still checked: ready when WebDriverAgent answers', async () => {
      wdaAsked.resolves(true);
      const manager = new IOSDeviceManager({ pluginArgs } as any);

      expect(await manager.readyForSession(iphone())).to.equal(true);
      expect(wdaAsked.calledOnceWith(IPHONE)).to.equal(true);
    });

    it('is still refused when WebDriverAgent does not answer and cannot be started', async () => {
      const manager = new IOSDeviceManager({ pluginArgs } as any);
      const recover = sandbox.stub(manager, 'recoverHealth').resolves(false);

      expect(await manager.readyForSession(iphone())).to.equal(false);
      expect(recover.calledOnce).to.equal(true);
    });
  });
});
