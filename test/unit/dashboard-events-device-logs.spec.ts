import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { getXenonCapabilities } from '../../src/XenonCapabilityManager';
import * as assets from '../../src/dashboard/asset-manager';
import * as sessionService from '../../src/dashboard/services/session-service';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SocketServer } from '../../src/services/SocketServer';
import { TracingService } from '../../src/services/TracingService';
import { MetricsService } from '../../src/services/MetricsService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import * as pendingSessions from '../../src/data-service/pending-sessions-service';
import * as deviceService from '../../src/data-service/device-service';
import * as deviceUtils from '../../src/device-utils';
import { config } from '../../src/config';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';
import { useLokiStores } from '../helpers/loki-stores';

/**
 * A session's device log is recorded from about when its phone was given to
 * it, once the session's row exists (the lines point at it), and written to
 * the end however the session ends: every ending reaches onSessionStopped.
 */
describe('EventManager: an Android session’s device log', () => {
  let restore: () => void;
  let deviceLogs: { start: sinon.SinonStub; stop: sinon.SinonStub; noteOff: sinon.SinonStub };
  let order: string[];

  beforeEach(() => {
    restore = saveRegistrations(SessionDeviceLogs, SessionMetricsService, SocketServer);
    order = [];
    deviceLogs = {
      start: sinon.stub().callsFake(async () => order.push('device logs')),
      stop: sinon.stub().resolves(),
      noteOff: sinon.stub().resolves(),
    };
    Container.set(SessionDeviceLogs, deviceLogs as any);
    Container.set(SessionMetricsService, {
      appliesTo: () => false,
      start: sinon.stub(),
      stop: sinon.stub().resolves(),
    } as any);
    Container.set(SocketServer, {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      hasScopedDashboard: sinon.stub().returns(false),
    } as any);
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  function startSession(platform: string, deviceLog?: () => unknown) {
    sinon.stub(assets, 'prepareDirectory');
    sinon.stub(sessionService, 'getOrCreateNewBuild').resolves({ id: 'b-logs' } as any);
    sinon.stub(TracingService.prototype, 'getTraceId').returns('t-1' as any);
    sinon.stub(MetricsService.prototype, 'incrementSessionStart');
    sinon.stub(prisma.session as any, 'create').callsFake(async () => {
      order.push('row');
      return {} as any;
    });
    const session = {
      getId: () => 's-logs-1',
      getCapabilities: () => ({ platformName: platform }),
      getLiveVideoUrl: () => null,
      startPerformanceRecording: sinon.stub().resolves(),
      apiKeyId: null,
      userId: null,
      allocatedAt: 1_700_000_000_000,
      ...(deviceLog ? { deviceLog } : {}),
    };
    const device = { udid: 'phone-l', platform, host: 'h', name: 'phone', sdk: '10' };
    return { session, device };
  }

  it("starts once the session's row is written, from when the phone was given to it", async () => {
    const { session, device } = startSession('android');

    await DASHBORD_EVENT_MANAGER.onSessionStarted({}, session as any, device as any);

    expect(order).to.deep.equal(['row', 'device logs']);
    expect(deviceLogs.start.firstCall.args[0]).to.deep.equal({
      sessionId: 's-logs-1',
      device,
      since: 1_700_000_000_000,
      driverLog: undefined,
      appUnderTest: undefined,
    });
  });

  // The switch, from the session's capabilities as the create parses them.
  const parsed = (alwaysMatch: Record<string, unknown>) =>
    getXenonCapabilities({ alwaysMatch, firstMatch: [{}] } as any);

  function stubSessionStart() {
    sinon.stub(assets, 'prepareDirectory');
    sinon.stub(sessionService, 'getOrCreateNewBuild').resolves({ id: 'b-logs' } as any);
    sinon.stub(TracingService.prototype, 'getTraceId').returns('t-1' as any);
    sinon.stub(MetricsService.prototype, 'incrementSessionStart');
    sinon.stub(prisma.session as any, 'create').resolves({} as any);
    return {
      session: {
        getId: () => 's-logs-off',
        getCapabilities: () => ({ platformName: 'Android' }),
        getLiveVideoUrl: () => null,
        apiKeyId: null,
        userId: null,
      },
      device: { udid: 'phone-l', platform: 'android', host: 'h', name: 'S9', sdk: '10' },
    };
  }

  it('records it when the session says nothing', async () => {
    const { session, device } = stubSessionStart();

    await DASHBORD_EVENT_MANAGER.onSessionStarted(parsed({}), session as any, device as any);

    expect(deviceLogs.start.calledOnce).to.equal(true);
    expect(deviceLogs.noteOff.called).to.equal(false);
  });

  it('keeps none, and says so, for a session that turned it off', async () => {
    const { session, device } = stubSessionStart();

    await DASHBORD_EVENT_MANAGER.onSessionStarted(
      parsed({ 'xe:save_device_logs': false }),
      session as any,
      device as any,
    );

    expect(deviceLogs.start.called).to.equal(false);
    expect(deviceLogs.noteOff.calledOnceWithExactly('s-logs-off')).to.equal(true);
  });

  it("doesn't listen to an iPhone's driver log when the session turned it off", async () => {
    const driverLog = { on: sinon.stub(), removeListener: sinon.stub() };
    const { session, device } = startSession('ios', () => driverLog);

    await DASHBORD_EVENT_MANAGER.onSessionStarted(
      parsed({ 'xe:saveDeviceLogs': 'false' }),
      session as any,
      device as any,
    );

    expect(deviceLogs.start.called).to.equal(false);
    expect(deviceLogs.noteOff.calledOnceWithExactly('s-logs-1')).to.equal(true);
    expect(driverLog.on.called).to.equal(false);
  });

  it("hands an iPhone's session the log its driver captures, and its app", async () => {
    const driverLog = { on() {}, removeListener() {} };
    const { session, device } = startSession('ios', () => driverLog);
    (session as any).appUnderTest = () => 'com.example.shop';

    await DASHBORD_EVENT_MANAGER.onSessionStarted({}, session as any, device as any);

    expect(deviceLogs.start.firstCall.args[0].driverLog).to.equal(driverLog);
    expect(deviceLogs.start.firstCall.args[0].appUnderTest).to.equal('com.example.shop');
  });

  it('writes it to the end when the session stops, even one no longer in memory', async () => {
    sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({ getDevices: async () => [] } as any);
    sinon
      .stub(prisma.session, 'findFirst')
      .resolves({ id: 's-logs-2', status: 'running', device_udid: 'phone-l' } as any);
    sinon.stub(prisma.session, 'update').resolves({} as any);
    sinon.stub(prisma.sessionLog, 'findFirst').resolves(null);
    let statusWritten = false;
    (prisma.session.update as sinon.SinonStub).callsFake(async () => {
      statusWritten = true;
      return {} as any;
    });
    deviceLogs.stop.callsFake(async () => {
      // The session page reads the device log again once the session has
      // ended: by then every line is written.
      expect(statusWritten, 'the session was marked ended first').to.equal(false);
    });

    await DASHBORD_EVENT_MANAGER.onSessionStopped('s-logs-2');

    expect(deviceLogs.stop.calledOnceWithExactly('s-logs-2')).to.equal(true);
    expect(statusWritten).to.equal(true);
  });
});

describe('createSession: when the phone was given to the session', () => {
  useLokiStores();
  let context: PluginContext;
  let saved: Partial<PluginContext>;
  let authDisabledBefore: boolean;

  beforeEach(() => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = true;
    context = Container.get(PluginContext);
    saved = { pluginArgs: context.pluginArgs, nodeId: context.nodeId };
    context.pluginArgs = Object.assign({}, DefaultPluginArgs, { bindHostOrIp: '127.0.0.1' });
    context.nodeId = 'node-here';
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    Object.assign(context, saved);
    sinon.restore();
  });

  it('is noted on the session, between the allocation and the driver starting', async () => {
    const device = {
      udid: 'u1',
      host: 'h1',
      platform: 'android',
      nodeId: 'node-here',
      teamId: null,
    };
    let allocatedBy = 0;
    let driverAt = 0;
    sinon.stub(pendingSessions, 'addNewPendingSession').resolves();
    sinon.stub(pendingSessions, 'removePendingSession').resolves();
    sinon.stub(deviceService, 'updateDeviceProgress').resolves();
    sinon.stub(deviceService, 'updatedAllocatedDevice').resolves();
    sinon.stub(deviceUtils, 'allocateDeviceForSession').callsFake(async () => {
      allocatedBy = Date.now();
      return device as any;
    });
    const svc = new SessionLifecycleService();
    const instance: Record<string, unknown> = {};
    sinon.stub(svc as any, 'createSessionInstance').returns(instance);
    sinon.stub(svc as any, 'applyPostSessionLogic').resolves();
    const next = sinon.stub().callsFake(async () => {
      driverAt = Date.now();
      // A slow driver start: the session's log still counts from before it.
      await new Promise((r) => setTimeout(r, 20));
      return { value: ['s-alloc', { platformName: 'Android' }] };
    });

    await svc.createSession(next, {}, {
      alwaysMatch: { platformName: 'Android', 'appium:automationName': 'UiAutomator2' },
      firstMatch: [{}],
    } as any);

    expect(instance.allocatedAt).to.be.a('number');
    expect(instance.allocatedAt as number).to.be.at.least(allocatedBy);
    expect(instance.allocatedAt as number).to.be.at.most(driverAt);
  });
});
