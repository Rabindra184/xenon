import 'reflect-metadata';
import { expect } from 'chai';
import axios from 'axios';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SocketServer } from '../../src/services/SocketServer';
import { MetricsService } from '../../src/services/MetricsService';
import { NotificationService } from '../../src/services/NotificationService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { SessionStatus } from '../../src/types/SessionStatus';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * `session_failed` goes out when a session ends as failed, whichever way it
 * ends, and once per session.
 *
 * It was sent only from the client's own delete, so a session that timed out
 * for inactivity, whose driver crashed, or whose heartbeat stopped was marked
 * failed on the dashboard and counted in the failure metric, and no webhook
 * heard of it. Every one of those ends through `onSessionStopped`, which is
 * where the final status is decided, so that is where it is sent. A session
 * that ends twice (a crash, then the client's delete) is still sent once.
 */
describe('session_failed: when it is sent', () => {
  const URL = 'https://hooks.example.com/T000/B000/xyz';
  let restore: () => void;
  let post: sinon.SinonStub;
  let row: any;
  let svc: NotificationService;

  beforeEach(() => {
    restore = saveRegistrations(SessionMetricsService, SocketServer, MetricsService);
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    Container.set(SocketServer, {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      hasScopedDashboard: sinon.stub().returns(false),
    } as any);
    Container.set(MetricsService, {
      incrementSessionSuccess: sinon.stub(),
      incrementSessionFailure: sinon.stub(),
    } as any);

    sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns({ getDevices: async () => [], findDevices: async () => [] } as any);
    sinon.stub(prisma.sessionLog, 'findFirst').resolves(null);
    row = {
      id: 'sess-1',
      name: 'Checkout flow',
      status: 'running',
      failure_reason: null,
      device_udid: 'R58M123',
      device_name: 'Galaxy S9+',
      device_platform: 'android',
      device_version: '10',
      startTime: new Date('2026-10-04T09:00:00.000Z'),
      endTime: null,
      desired_capabilities: '{"appium:app":"/secret.apk"}',
    };
    sinon.stub(prisma.session, 'findFirst').callsFake((async () => ({ ...row })) as any);
    sinon.stub(prisma.session, 'update').callsFake((async ({ data }: any) => {
      row = { ...row, ...data };
      return row;
    }) as any);

    // A real service with a slack webhook for the event, so what is checked is
    // what would reach the channel.
    svc = Container.get(NotificationService);
    post = sinon.stub(axios, 'post').resolves({ status: 200 });
    sinon
      .stub(svc, 'getConfigs')
      .resolves([
        { id: 'w', url: URL, events: '["session_failed"]', type: 'slack', active: true },
      ] as any);
    // A session id nobody has notified for yet, however many specs ran before.
    row.id = `sess-${Math.random().toString(36).slice(2)}`;
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  /** onSessionStopped fires the webhook without being awaited: let it finish. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  it('is sent when a session times out for inactivity (device-utils)', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(
      row.id,
      'failed' as any,
      'Session timed out due to inactivity',
    );
    await settle();

    expect(post.calledOnce).to.equal(true);
    const text = post.firstCall.args[1].attachments[0].text;
    expect(text).to.contain(row.id);
    expect(text).to.contain('Session timed out due to inactivity');
    expect(text).to.contain('Galaxy S9+');
    expect(text).not.to.contain('undefined');
  });

  it('is sent when the driver crashes (plugin onUnexpectedShutdown)', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(
      row.id,
      SessionStatus.FAILED,
      'Driver shut down unexpectedly',
    );
    await settle();

    expect(post.calledOnce).to.equal(true);
    expect(post.firstCall.args[1].attachments[0].text).to.contain('Driver shut down unexpectedly');
  });

  it('is sent when the heartbeat stops (OrphanSweeper)', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(
      row.id,
      SessionStatus.FAILED,
      'Session heartbeat timeout',
    );
    await settle();

    expect(post.calledOnce).to.equal(true);
  });

  it('is sent when the client deletes a session a command failed in', async () => {
    (prisma.sessionLog.findFirst as sinon.SinonStub).resolves({
      command_name: 'findElement',
      response: '{"value":{"error":"no such element"}}',
    });

    await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id);
    await settle();

    expect(post.calledOnce).to.equal(true);
    expect(post.firstCall.args[1].attachments[0].text).to.contain('no such element');
  });

  it('is sent when the test marked the session failed and the client then deletes it', async () => {
    row.status = 'failed';
    row.failure_reason = 'Assertion failed: total is 12';

    await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id);
    await settle();

    expect(post.calledOnce).to.equal(true);
    expect(post.firstCall.args[1].attachments[0].text).to.contain('Assertion failed: total is 12');
  });

  it('is not sent for a session that passes', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id);
    await settle();

    expect(row.status).to.equal('success');
    expect(post.called).to.equal(false);
  });

  it('is sent once when a session ends twice: a crash, then the client’s delete', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(
      row.id,
      SessionStatus.FAILED,
      'Driver shut down unexpectedly',
    );
    await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id);
    await settle();

    expect(post.callCount).to.equal(1);
  });

  it('is not sent when the server itself is shutting down', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id, SessionStatus.FAILED, 'Hub shutdown', {
      notify: false,
    });
    await settle();

    expect(row.status).to.equal('failed'); // still recorded as failed
    expect(post.called).to.equal(false);
  });

  it('does not hold the session’s end up for a webhook, and survives one that fails', async () => {
    post.rejects(new Error('slack is down'));

    await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id, SessionStatus.FAILED, 'boom');
    await settle();

    expect(row.status).to.equal('failed');
  });

  it('does not send the session’s capabilities to the webhook', async () => {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id, SessionStatus.FAILED, 'boom');
    await settle();

    expect(JSON.stringify(post.firstCall.args[1])).not.to.contain('secret.apk');
  });
});
