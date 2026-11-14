import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DeviceReconciler } from '../../src/services/DeviceReconciler';
import { HealthMonitorService } from '../../src/device-managers/HealthMonitorService';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { AppiumUmbrella } from '../../src/sessions/appiumUmbrella';
import { isSessionLiveHere } from '../../src/sessions/sessionLiveness';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A local session goes into SESSION_MANAGER only with the dashboard on or its
 * video recorded. On a default server (dashboard off) a session with
 * `xe:record_video: false` is in no map, and two sweepers took that for a dead
 * session: DeviceReconciler freed its phone a minute into the test, and the
 * health monitor reclaimed it as a zombie. Both now ask Appium too.
 */
describe('Sweepers judge a session live by Appium, not SESSION_MANAGER alone', () => {
  const HOST = 'http://127.0.0.1:4723';
  const OLD = Date.now() - 10 * 60_000;
  const umbrella = Container.get(AppiumUmbrella);
  let savedUmbrella: unknown;
  let release: sinon.SinonStub;
  let releaseLeaseLock: sinon.SinonStub;
  let updateDevice: sinon.SinonSpy;
  let rows: any[];

  beforeEach(() => {
    sinon.stub(process, 'kill');
    savedUmbrella = (umbrella as any).umbrella;
    // Appium runs one session, `local-no-video`, which SESSION_MANAGER
    // doesn't hold (dashboard off, no video).
    umbrella.note({ sessionExists: (id: string) => id === 'local-no-video' });
    sinon.stub(SESSION_MANAGER, 'isValidSession').returns(false);
    release = sinon.stub(deviceService, 'releaseSessionDevice').resolves(true);
    releaseLeaseLock = sinon.stub().resolves(true);
    updateDevice = sinon.spy(async () => undefined);
    rows = [];
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      getAllDevices: async () => rows,
      updateDevice,
      releaseLeaseLock,
    } as any);
  });

  afterEach(() => {
    (umbrella as any).umbrella = savedUmbrella;
    sinon.restore();
  });

  const phone = (udid: string, extra: Record<string, unknown>) => ({
    udid,
    host: HOST,
    platform: 'android',
    busy: true,
    sessionStartTime: OLD,
    ...extra,
  });

  it('isSessionLiveHere answers for a session only Appium has', () => {
    expect(isSessionLiveHere('local-no-video')).to.equal(true);
    expect(isSessionLiveHere('gone')).to.equal(false);
    expect(isSessionLiveHere(null)).to.equal(false);
  });

  describe('DeviceReconciler', () => {
    it('leaves the phone of a running session SESSION_MANAGER doesn’t hold', async () => {
      rows = [phone('p1', { session_id: 'local-no-video', claimSessionId: 'local-no-video' })];
      await new DeviceReconciler().reconcile();
      expect(release.called).to.equal(false);
    });

    it('still frees the phone of a session that has gone', async () => {
      rows = [phone('p2', { session_id: 'gone', claimSessionId: 'gone' })];
      await new DeviceReconciler().reconcile();
      expect(release.calledOnceWith('p2', HOST, 'gone')).to.equal(true);
    });

    it('leaves a preview’s or a recording’s hold to its own release', async () => {
      rows = [phone('p3', { session_id: 'manual_user-1_p3' })];
      await new DeviceReconciler().reconcile();
      expect(release.called).to.equal(false);
    });
  });

  describe('HealthMonitorService', () => {
    class AndroidDeviceManager {
      checked: string[] = [];
      checkHealth = async (device: { udid: string }) => {
        this.checked.push(device.udid);
        return { healthStatus: 'Healthy' };
      };
    }
    let manager: AndroidDeviceManager;
    let restore: () => void;
    let context: PluginContext;
    let saved: Partial<PluginContext>;

    beforeEach(() => {
      manager = new AndroidDeviceManager();
      restore = saveRegistrations(XenonManager);
      Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
      context = Container.get(PluginContext);
      saved = { ...context };
      context.setContext(
        { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any,
        4723,
        'own',
        '',
      );
    });

    afterEach(() => {
      Object.assign(context, saved);
      restore();
    });

    const run = () => {
      const monitor = new HealthMonitorService({} as any);
      monitor.readLeasedPhones = async () => new Map();
      return (monitor as any).checkAllDevices();
    };

    it('doesn’t take a running session’s phone for a zombie', async () => {
      rows = [
        phone('p4', {
          nodeId: 'own',
          session_id: 'local-no-video',
          claimSessionId: 'local-no-video',
        }),
      ];
      await run();
      expect(release.called).to.equal(false);
      const writes = updateDevice.getCalls().map((c) => c.args[2]);
      expect(writes.some((w) => w && w.busy === false)).to.equal(false);
    });

    it('reclaims a zombie by its session’s claim, never a plain busy:false', async () => {
      rows = [phone('p5', { nodeId: 'own', session_id: 'gone', claimSessionId: 'gone' })];
      await run();
      expect(release.calledOnceWith('p5', HOST, 'gone')).to.equal(true);
      for (const call of updateDevice.getCalls()) {
        expect(call.args[2]).to.not.have.property('busy');
        expect(call.args[2]).to.not.have.property('session_id');
      }
    });

    it('clears a busy phone with no session on record only where nothing holds it', async () => {
      rows = [phone('p6', { nodeId: 'own', session_id: null, claimSessionId: null })];
      await run();
      expect(release.called).to.equal(false);
      expect(releaseLeaseLock.calledOnceWith('p6', HOST)).to.equal(true);
    });
  });
});
