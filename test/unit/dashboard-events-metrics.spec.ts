import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import * as assets from '../../src/dashboard/asset-manager';
import * as sessionService from '../../src/dashboard/services/session-service';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SocketServer } from '../../src/services/SocketServer';
import { TracingService } from '../../src/services/TracingService';
import { MetricsService } from '../../src/services/MetricsService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * EventManager starts a session's sampling once the session's row exists (the
 * samples point at it) and stops it however the session ends, in memory or
 * not.
 */
describe('EventManager: CPU and memory sampling', () => {
  let restore: () => void;
  let metrics: { appliesTo: sinon.SinonStub; start: sinon.SinonStub; stop: sinon.SinonStub };
  let order: string[];

  beforeEach(() => {
    restore = saveRegistrations(SessionMetricsService, SocketServer);
    order = [];
    metrics = {
      appliesTo: sinon.stub().returns(true),
      start: sinon.stub().callsFake(() => order.push('metrics')),
      stop: sinon.stub().resolves(),
    };
    Container.set(SessionMetricsService, metrics as any);
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

  function startSession() {
    sinon.stub(assets, 'prepareDirectory');
    sinon.stub(sessionService, 'getOrCreateNewBuild').resolves({ id: 'b-metrics' } as any);
    sinon.stub(TracingService.prototype, 'getTraceId').returns('t-1' as any);
    sinon.stub(MetricsService.prototype, 'incrementSessionStart');
    const create = sinon.stub(prisma.session as any, 'create').callsFake(async () => {
      order.push('row');
      return {} as any;
    });
    const session = {
      getId: () => 's-metrics-1',
      getCapabilities: () => ({ platformName: 'Android' }),
      getLiveVideoUrl: () => null,
      startPerformanceRecording: sinon.stub().resolves(),
      apiKeyId: null,
      userId: null,
    };
    const device = {
      udid: 'phone-m',
      platform: 'android',
      realDevice: true,
      host: 'h',
      name: 'S9',
      sdk: '10',
    };
    return { create, session, device };
  }

  it("starts sampling once the session's row is written, and says so on the row", async () => {
    const { create, session, device } = startSession();

    await DASHBORD_EVENT_MANAGER.onSessionStarted({}, session as any, device as any);

    expect(order).to.deep.equal(['row', 'metrics']);
    expect(metrics.start.firstCall.args[0]).to.deep.equal({
      sessionId: 's-metrics-1',
      device,
      capabilities: { platformName: 'Android' },
    });
    expect(create.firstCall.args[0].data.is_profiling_available).to.equal(true);
  });

  it("doesn't sample a phone the service doesn't apply to", async () => {
    metrics.appliesTo.returns(false);
    const { session, device } = startSession();

    await DASHBORD_EVENT_MANAGER.onSessionStarted({}, session as any, device as any);

    expect(metrics.start.called).to.equal(false);
  });

  it('stops sampling when the session stops, even one no longer in memory', async () => {
    sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({ getDevices: async () => [] } as any);
    sinon
      .stub(prisma.session, 'findFirst')
      .resolves({ id: 's-metrics-2', status: 'running', device_udid: 'phone-m' } as any);
    sinon.stub(prisma.session, 'update').resolves({} as any);
    sinon.stub(prisma.sessionLog, 'findFirst').resolves(null);

    await DASHBORD_EVENT_MANAGER.onSessionStopped('s-metrics-2');

    expect(metrics.stop.calledOnceWithExactly('s-metrics-2')).to.equal(true);
  });

  it("hands the service a node's session, to collect its figures from the node", async () => {
    const { session, device } = startSession();
    const remote = Object.assign(session, {
      nodeOrigin: () => 'http://node:4723',
      nodeMetrics: async () => ({ kind: 'refused' }),
    });

    await DASHBORD_EVENT_MANAGER.onSessionStarted({}, remote as any, device as any);

    expect(metrics.appliesTo.firstCall.args).to.deep.equal([device, remote]);
    expect(metrics.start.firstCall.args[0].source).to.equal(remote);
  });
});
