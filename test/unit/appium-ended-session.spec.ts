import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import * as DeviceService from '../../src/data-service/device-service';
import * as OwnDeviceRow from '../../src/device-managers/ownDeviceRow';
import * as FailureAnalysis from '../../src/dashboard/services/failure-analysis-service';
import { InternalHttpClient } from '../../src/InternalHttpClient';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionHeartbeatService } from '../../src/services/SessionHeartbeatService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { PhoneNetworkRestore } from '../../src/services/network/PhoneNetworkRestore';
import { PortAllocator } from '../../src/services/PortAllocator';
import { OrphanSweeper } from '../../src/services/OrphanSweeper';
import { SocketServer } from '../../src/services/SocketServer';
import { MetricsService } from '../../src/services/MetricsService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionStatus } from '../../src/types/SessionStatus';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

const TIMEOUT_REASON =
  'New Command Timeout of 60 seconds expired. Try customizing the timeout using the ' +
  "'newCommandTimeout' desired capability";

/** Appium's cause for an idle session, as the umbrella hands it to the plugin. */
const idleCause = () => new Error(TIMEOUT_REASON);

/**
 * When Appium ends a session itself (its new-command timeout, a crashed
 * driver), the plugin's onUnexpectedShutdown is the only ending the session
 * gets. Through 2.36 it left the session in SESSION_MANAGER, so the heartbeat
 * kept probing it, found the driver gone and, six ticks later, ended it a
 * second time: the row's failure reason was rewritten from Appium's to
 * "Session terminal failure", the failure analysis ran again, the phone's
 * ports were released under whatever session held it by then, and the ended
 * row kept getting heartbeats. A node posted the hub's admin /unblock (which
 * always answered 400) instead of releasing its own phone, and the session's
 * video ffmpeg was stopped only on a hub with the dashboard on.
 */
describe('when Appium ends a session itself', function () {
  this.timeout(30_000);
  useScratchDatabase();
  let restoreRegs: () => void;
  let order: string[];
  let release: sinon.SinonStub;
  let stopped: sinon.SinonStub;
  const added: string[] = [];

  /** A session Xenon keeps in memory (the dashboard or video on), recording video. */
  function registered(id: string) {
    let recording = true;
    const session: any = {
      isStopping: false,
      stoppedAt: undefined,
      getId: () => id,
      getDevice: () => ({ udid: 'R5CT', host: 'http://127.0.0.1:4723', platform: 'android' }),
      isVideoRecordingInProgress: () => recording,
      stopVideoRecording: sinon.stub().callsFake(async () => {
        order.push(
          `video ${id}${SESSION_MANAGER.getSession(id) === session ? ' (registered)' : ''}`,
        );
        recording = false;
        return null;
      }),
      stopPerformanceRecording: sinon.stub().resolves(null),
      checkHealth: sinon.stub().resolves({ isHealthy: false, errorType: 'SESSION_NOT_FOUND' }),
    };
    SESSION_MANAGER.addSession(id, session);
    added.push(id);
    return session;
  }

  const shutDown = (pluginArgs: Record<string, unknown>, driver: Record<string, unknown>) =>
    XenonPlugin.prototype.onUnexpectedShutdown.call({ pluginArgs } as any, driver, idleCause());

  beforeEach(() => {
    restoreRegs = saveRegistrations(
      PhoneNetworkRestore,
      SessionMetricsService,
      SessionDeviceLogs,
      PortAllocator,
    );
    order = [];
    Container.set(PhoneNetworkRestore, {
      restoreSession: sinon.stub().resolves(),
      restoreAll: sinon.stub().resolves(),
    } as any);
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    Container.set(SessionDeviceLogs, { stop: sinon.stub().resolves() } as any);
    Container.set(PortAllocator, {
      // A session gives back only the ports it owns (releaseForSession).
      releaseForSession: sinon.stub().callsFake(async (sessionId: string) => {
        order.push(`ports ${sessionId}`);
      }),
    } as any);
    release = sinon.stub(DeviceService, 'releaseSessionDevices').callsFake(async (id: string) => {
      order.push(`release ${id}`);
    });
    stopped = sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').callsFake((async (
      id: string,
    ) => {
      order.push(`stopped ${id}${SESSION_MANAGER.getSession(id) ? ' (registered)' : ''}`);
      return SessionStatus.FAILED;
    }) as any);
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
    for (const id of added.splice(0)) SESSION_MANAGER.removeSession(id);
  });

  it('takes the session out of SESSION_MANAGER, so nothing ends it again', async () => {
    const session = registered('s-gone');
    await shutDown({}, { sessionId: 's-gone', caps: { udid: 'R5CT' } });

    expect(SESSION_MANAGER.getSession('s-gone')).to.equal(undefined);
    expect(session.isStopping).to.equal(true);
  });

  it('the heartbeat then never ends it a second time, and a client’s delete records nothing more', async () => {
    registered('s-twice');
    await shutDown({ enableDashboard: true }, { sessionId: 's-twice', caps: { udid: 'R5CT' } });
    const deleteSession = sinon.stub(SessionLifecycleService.prototype, 'deleteSession').resolves();
    sinon
      .stub(SESSION_MANAGER, 'getAllSessions')
      .callsFake(() =>
        [...(SESSION_MANAGER as any).sessionMap.values()].filter(
          (s: any) => s.getId() === 's-twice',
        ),
      );

    const heartbeat = new SessionHeartbeatService();
    for (let tick = 0; tick < 7; tick++) await (heartbeat as any).checkAllSessions();
    expect(deleteSession.called).to.equal(false);

    deleteSession.restore();
    await Container.get(SessionLifecycleService).deleteSession(async () => null, 's-twice');
    expect(order.filter((step) => step.startsWith('stopped'))).to.have.length(1);
  });

  it('stops the session’s video on a standalone server with the dashboard off, before forgetting it', async () => {
    const session = registered('s-video');
    await shutDown({ enableDashboard: false }, { sessionId: 's-video', caps: { udid: 'R5CT' } });

    expect(session.stopVideoRecording.calledOnce).to.equal(true);
    expect(order).to.include('video s-video (registered)');
  });

  it('on a node: stops the video, releases its own phone by the session’s claim, sends the hub nothing', async () => {
    const post = sinon.stub().resolves({ status: 200 });
    sinon.stub(InternalHttpClient, 'getClient').returns({ post } as any);
    const session = registered('s-node');

    await shutDown({ hub: 'http://hub:4723' }, { sessionId: 's-node', caps: { udid: 'R5CT' } });

    expect(session.stopVideoRecording.calledOnce).to.equal(true);
    expect(release.calledOnceWith('s-node')).to.equal(true);
    expect(post.called).to.equal(false);
    expect(SESSION_MANAGER.getSession('s-node')).to.equal(undefined);
  });

  it('archives the video and gives back the ports before the phone is released', async () => {
    registered('s-order');
    await shutDown({}, { sessionId: 's-order', caps: { udid: 'R5CT' } });

    // The ports may be given back more than once (forgetSessionMemory and
    // finalizeCleanup both release the session's own); what matters is that
    // they and the video go before the phone does.
    const releaseAt = order.indexOf('release s-order');
    expect(releaseAt).to.be.greaterThan(-1);
    expect(order.indexOf('ports s-order')).to.be.within(0, releaseAt - 1);
    expect(order.indexOf('video s-order (registered)')).to.be.within(0, releaseAt - 1);
  });

  it('records the end with Appium’s cause where the dashboard records sessions, before forgetting it', async () => {
    const wasHub = XenonPlugin.IS_HUB;
    XenonPlugin.IS_HUB = true;
    try {
      registered('s-dash');
      await shutDown({ enableDashboard: true }, { sessionId: 's-dash', caps: { udid: 'R5CT' } });
    } finally {
      XenonPlugin.IS_HUB = wasHub;
    }

    expect(stopped.calledOnce).to.equal(true);
    expect(stopped.firstCall.args.slice(0, 3)).to.deep.equal([
      's-dash',
      SessionStatus.FAILED,
      TIMEOUT_REASON,
    ]);
    expect(order).to.include('stopped s-dash (registered)');
  });

  it('with no session id, frees only this server’s own row for the phone', async () => {
    const own = { udid: 'emulator-5554', host: 'http://127.0.0.1:4723' };
    const findOwn = sinon.stub(OwnDeviceRow, 'findOwnDevice').resolves(own as any);
    const unblock = sinon.stub(DeviceService, 'unblockDevice').resolves();
    const byFilter = sinon.stub(DeviceService, 'unblockDeviceMatchingFilter').resolves();

    await shutDown({}, { sessionId: undefined, caps: { udid: 'emulator-5554' } });

    expect(findOwn.calledOnceWith('emulator-5554')).to.equal(true);
    expect(unblock.calledOnceWith('emulator-5554', 'http://127.0.0.1:4723')).to.equal(true);
    expect(byFilter.called).to.equal(false);
  });

  it('with no session id and no row of its own, frees nothing', async () => {
    sinon.stub(OwnDeviceRow, 'findOwnDevice').resolves(null);
    const unblock = sinon.stub(DeviceService, 'unblockDevice').resolves();
    const byFilter = sinon.stub(DeviceService, 'unblockDeviceMatchingFilter').resolves();

    await shutDown({}, { sessionId: undefined, caps: { udid: 'emulator-5554' } });

    expect(unblock.called).to.equal(false);
    expect(byFilter.called).to.equal(false);
  });
});

/**
 * A session's row records its first ending. A later one (the heartbeat after
 * Appium's own end, a client's delete after a crash) changes neither its
 * status nor its reason, and starts no second failure analysis. A verdict the
 * test set while the session ran (`xenon: setSessionStatus`) is not an end:
 * the row has no endTime yet.
 */
describe('a session that has already ended keeps its first outcome', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  const ID = 'sess-first-outcome';
  let restoreRegs: () => void;
  let categorize: sinon.SinonStub;

  beforeEach(async () => {
    restoreRegs = saveRegistrations(
      SessionMetricsService,
      SessionDeviceLogs,
      SocketServer,
      MetricsService,
      PhoneNetworkRestore,
    );
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    Container.set(SessionDeviceLogs, { stop: sinon.stub().resolves() } as any);
    Container.set(SocketServer, {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      hasScopedDashboard: sinon.stub().returns(false),
    } as any);
    Container.set(MetricsService, {
      incrementSessionSuccess: sinon.stub(),
      incrementSessionFailure: sinon.stub(),
    } as any);
    Container.set(PhoneNetworkRestore, { restoreSession: sinon.stub().resolves() } as any);
    sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns({ getDevices: async () => [], findDevices: async () => [] } as any);
    sinon.stub(DeviceService, 'releaseSessionDevices').resolves();
    categorize = sinon.stub(FailureAnalysis, 'categorizeSessionFailure').resolves();
    sinon.stub(FailureAnalysis, 'explainSessionFailure').resolves();

    await scratch.db.sessionLog.deleteMany();
    await scratch.db.session.deleteMany();
    await scratch.db.session.create({
      data: {
        id: ID,
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node',
        has_live_video: false,
        device_udid: 'R58M123',
        device_platform: 'android',
        device_version: '10',
        last_heartbeat_at: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
  });

  const row = () => scratch.db.session.findUnique({ where: { id: ID } });

  it('a second ending does not rewrite the reason or analyse again', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(ID, SessionStatus.FAILED, TIMEOUT_REASON);
    const first = await row();

    const answered = await DASHBORD_EVENT_MANAGER.onSessionStopped(
      ID,
      SessionStatus.FAILED,
      'Session terminal failure (SESSION_NOT_FOUND: The session no longer exists)',
    );

    const second = await row();
    expect(second!.failure_reason).to.equal(TIMEOUT_REASON);
    expect(second!.status).to.equal('failed');
    expect(second!.endTime!.getTime()).to.equal(first!.endTime!.getTime());
    expect(categorize.callCount).to.equal(1);
    expect(answered).to.equal(SessionStatus.FAILED);
  });

  it('a passed session stays passed when something ends it again as failed', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(ID);
    await DASHBORD_EVENT_MANAGER.onSessionStopped(ID, SessionStatus.FAILED, 'Shutdown timeout');

    const ended = await row();
    expect(ended!.status).to.equal('success');
    expect(ended!.failure_reason).to.equal(null);
    expect(categorize.called).to.equal(false);
  });

  it('a verdict the test set while running is not an end: the ending still records', async () => {
    await scratch.db.session.update({
      where: { id: ID },
      data: { status: 'failed', failure_reason: 'Assertion failed: total is 12' },
    });

    await DASHBORD_EVENT_MANAGER.onSessionStopped(ID);

    const ended = await row();
    expect(ended!.endTime).to.not.equal(null);
    expect(ended!.failure_reason).to.equal('Assertion failed: total is 12');
    expect(categorize.callCount).to.equal(1);
  });

  it('a stale heartbeat’s sweep still records the end and analyses it', async () => {
    await new OrphanSweeper().sweep({ heartbeatIntervalMs: 30_000 });

    const ended = await row();
    expect(ended!.status).to.equal('failed');
    expect(ended!.failure_reason).to.equal('Session heartbeat timeout');
    expect(ended!.endTime).to.not.equal(null);
    expect(categorize.callCount).to.equal(1);
  });
});
