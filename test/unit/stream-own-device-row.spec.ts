import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import { releaseIdlePreviewHold } from '../../src/device-managers/android/previewHold';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { PluginContext } from '../../src/PluginContext';
import { PortAllocator } from '../../src/services/PortAllocator';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';

/**
 * A hub's table holds its nodes' rows too, and a node on the same machine
 * sees the same phones (an iPhone, emulator-5554). The stream services
 * looked a phone up by udid alone, so on such a hub they could act on the
 * node's row: release the node's preview hold, or judge "an Appium session
 * holds this phone" from the node's session. A phone's own row is the one
 * filed under a host this server's discovery writes (localDeviceHosts).
 *
 * The store fake matches every key of the filter, as Prisma's findFirst does.
 */

const IP = '192.168.0.104';
const HUB = `http://${IP}:4724`;
const NODE = `http://${IP}:4725`;
const UDID = 'shared-phone-1';
/** A live-preview hold on the phone, as formatManualLock writes it. */
const hold = (userId: string) => `manual_${userId}_${UDID}`;

describe("stream services act on this server's own row for a udid", () => {
  let rows: Array<Partial<IDevice>>;
  let unblock: sinon.SinonStub;

  beforeEach(() => {
    rows = [];
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async (filter: Record<string, unknown>) =>
        (rows.find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ??
          null) as IDevice | null,
      updateDevice: async () => undefined,
    } as any);
    const hub = new PluginContext();
    hub.setContext(Object.assign({}, DefaultPluginArgs, { bindHostOrIp: IP }), 4724, 'hub', '');
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PluginContext) return hub;
      if (token === PortAllocator) return { release: async () => undefined };
      if (token === RecordingStore) return { isRecording: async () => false };
      if (token === AndroidH264StreamService) return { getMultiplexer: () => undefined };
      if (token === AndroidStreamService) return { getStreamStatus: () => undefined };
      return real(token);
    });
    unblock = sinon.stub(deviceService, 'unblockDevice').resolves();
    sinon.stub(process, 'kill');
  });

  afterEach(() => sinon.restore());

  function iosService(): any {
    // Bypass the constructor: it starts watchdog intervals.
    const svc: any = Object.create(IOSStreamService.prototype);
    svc.sessions = new Map();
    svc.startFlight = new SingleFlight();
    svc.recoveryCooldowns = new Map();
    svc.cleanupOrphanTunnels = async () => undefined;
    return svc;
  }

  it("iOS: stopping the hub's stream never releases the node's preview hold", async () => {
    rows = [
      { udid: UDID, host: NODE, platform: 'ios', busy: true, session_id: `manual_usr_bob_${UDID}` },
      { udid: UDID, host: HUB, platform: 'ios', busy: false, session_id: undefined },
    ];
    const svc = iosService();
    svc.sessions.set(UDID, {
      udid: UDID,
      wdaProcess: null,
      forwardWDAProcess: null,
      forwardMJPEGProcess: null,
      tunnelPort: null,
      wdaPort: 28101,
      mjpegPort: 29101,
      status: 'running',
      lastViewerAt: Date.now(),
      viewerCount: 0,
    });

    await svc.stopStream(UDID);

    expect(unblock.called, `unblocked ${JSON.stringify(unblock.args)}`).to.equal(false);
  });

  it("iOS: whether an Appium session holds the phone is read from the hub's own row", async () => {
    rows = [
      { udid: UDID, host: NODE, platform: 'ios', busy: false, session_id: undefined },
      { udid: UDID, host: HUB, platform: 'ios', busy: true, session_id: 'hub-appium-session' },
    ];

    expect(await iosService().appiumSessionMayUse(UDID, 'go-ios tunnels')).to.equal(true);
  });

  it("Android: a stopping preview never releases the node's preview hold", async () => {
    rows = [
      { udid: UDID, host: NODE, platform: 'android', busy: true, session_id: hold('usr_bob') },
      { udid: UDID, host: HUB, platform: 'android', busy: false, session_id: undefined },
    ];

    expect(await releaseIdlePreviewHold(UDID)).to.equal(false);
    expect(unblock.called).to.equal(false);
  });

  it("Android: the hub's own preview hold is still released", async () => {
    rows = [
      { udid: UDID, host: NODE, platform: 'android', busy: false, session_id: undefined },
      { udid: UDID, host: HUB, platform: 'android', busy: true, session_id: hold('usr_al') },
    ];

    expect(await releaseIdlePreviewHold(UDID)).to.equal(true);
    expect(unblock.calledOnceWith(UDID, HUB)).to.equal(true);
  });
});
