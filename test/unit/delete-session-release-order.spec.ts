import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import * as DeviceService from '../../src/data-service/device-service';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { PhoneNetworkRestore } from '../../src/services/network/PhoneNetworkRestore';
import { PortAllocator } from '../../src/services/PortAllocator';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionStatus } from '../../src/types/SessionStatus';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * A client's delete ends the session's own things (its phone's network, its
 * ports, its video) before the phone is released, as Appium's own end of a
 * session does (endSessionAppiumEnded). Through 2.36 deleteSession released
 * the phone first, so the next session could be given it while the old
 * session's video was still being written and its ports still held.
 */
describe('deleteSession: what goes before the phone is released', function () {
  this.timeout(30_000);
  useScratchDatabase();
  let restoreRegs: () => void;
  let order: string[];
  const added: string[] = [];

  function registered(id: string, opts: { videoThrows?: boolean } = {}) {
    let recording = true;
    const session: any = {
      isStopping: false,
      stoppedAt: undefined,
      getId: () => id,
      getDevice: () => ({ udid: 'R5CT', host: 'http://127.0.0.1:4723', platform: 'android' }),
      isVideoRecordingInProgress: () => recording,
      stopVideoRecording: sinon.stub().callsFake(async () => {
        order.push(`video ${id}`);
        recording = false;
        if (opts.videoThrows) throw new Error('ffmpeg would not stop');
        return null;
      }),
      stopPerformanceRecording: sinon.stub().resolves(null),
    };
    SESSION_MANAGER.addSession(id, session);
    added.push(id);
    return session;
  }

  const lifecycle = () => Container.get(SessionLifecycleService);

  beforeEach(() => {
    restoreRegs = saveRegistrations(
      PhoneNetworkRestore,
      SessionMetricsService,
      SessionDeviceLogs,
      PortAllocator,
    );
    order = [];
    Container.set(PhoneNetworkRestore, {
      restoreSession: sinon.stub().callsFake(async (id: string) => {
        order.push(`network ${id}`);
      }),
      restoreAll: sinon.stub().resolves(),
    } as any);
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    Container.set(SessionDeviceLogs, { stop: sinon.stub().resolves() } as any);
    Container.set(PortAllocator, {
      releaseForSession: sinon.stub().callsFake(async (id: string) => {
        order.push(`ports ${id}`);
      }),
    } as any);
    sinon.stub(DeviceService, 'releaseSessionDevices').callsFake(async (id: string) => {
      order.push(`release ${id}`);
    });
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').callsFake((async (id: string) => {
      order.push(`stopped ${id}`);
      return SessionStatus.SUCCESS;
    }) as any);
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
    for (const id of added.splice(0)) SESSION_MANAGER.removeSession(id);
  });

  it('puts the network back, then gives back the ports and stops the video, then releases the phone', async () => {
    registered('d-order');
    const next = sinon.stub().callsFake(async () => {
      order.push('driver delete');
      return null;
    });

    await lifecycle().deleteSession(next, 'd-order');

    const at = (step: string) => order.indexOf(step);
    expect(at('network d-order')).to.equal(0);
    expect(at('ports d-order')).to.be.greaterThan(at('network d-order'));
    expect(at('video d-order')).to.be.greaterThan(at('network d-order'));
    expect(at('release d-order')).to.be.greaterThan(at('ports d-order'));
    expect(at('release d-order')).to.be.greaterThan(at('video d-order'));
    // The rest of the delete is as it was: the driver's delete, then the end.
    expect(at('driver delete')).to.be.greaterThan(at('release d-order'));
    expect(at('stopped d-order')).to.be.greaterThan(at('driver delete'));
    expect(SESSION_MANAGER.getSession('d-order')).to.equal(undefined);
  });

  it('still releases the phone when stopping the video fails', async () => {
    registered('d-throws', { videoThrows: true });
    await lifecycle().deleteSession(async () => null, 'd-throws');
    expect(order).to.include('release d-throws');
  });

  it('releases the phone of a session SESSION_MANAGER does not hold', async () => {
    await lifecycle().deleteSession(async () => null, 'd-unregistered');
    expect(order.slice(0, 2)).to.deep.equal(['network d-unregistered', 'release d-unregistered']);
  });

  it('a session already stopping is not cleaned up twice, and its phone is still released', async () => {
    const session = registered('d-stopping');
    session.isStopping = true;
    await lifecycle().deleteSession(async () => null, 'd-stopping');
    expect(session.stopVideoRecording.called).to.equal(false);
    expect(order).to.include('release d-stopping');
  });
});
