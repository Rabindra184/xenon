import 'reflect-metadata';
import { expect } from 'chai';
import axios from 'axios';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import * as assets from '../../src/dashboard/asset-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { SocketServer } from '../../src/services/SocketServer';
import { TracingService } from '../../src/services/TracingService';
import { MetricsService } from '../../src/services/MetricsService';
import { NotificationService } from '../../src/services/NotificationService';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { SessionStatus } from '../../src/types/SessionStatus';
import {
  EVENT_TYPES,
  WEBHOOK_EVENTS,
  WEBHOOK_TIMEOUT_MS,
  healingEventPayload,
  sessionStartedPayload,
  sessionStoppedPayload,
} from '../../src/services/webhookEvents';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * ENH-07: `session_started`, `session_stopped` (every outcome) and
 * `healing_event`, beside `session_failed`. Each is sent where Xenon records
 * what it reports: the session's row, the end that decides its status, the
 * heal's command row. None holds up the session or the command.
 */
describe('Session lifecycle and heal webhooks (ENH-07)', () => {
  // Real rows: a session's end reads its row and its commands, and files a
  // failed one under a category.
  const scratch = useScratchDatabase();
  let restore: () => void;
  let sent: Array<{ event: string; payload: any }>;
  let svc: NotificationService;

  beforeEach(() => {
    restore = saveRegistrations(
      SessionMetricsService,
      SessionDeviceLogs,
      SocketServer,
      MetricsService,
      SelectorStateService,
    );
    Container.set(SessionMetricsService, {
      appliesTo: () => false,
      start: sinon.stub(),
      stop: sinon.stub().resolves(),
    } as any);
    Container.set(SessionDeviceLogs, {
      start: sinon.stub().resolves(),
      noteOff: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
    } as any);
    Container.set(SocketServer, {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      hasScopedDashboard: sinon.stub().returns(false),
    } as any);
    Container.set(MetricsService, {
      incrementSessionStart: sinon.stub(),
      incrementSessionSuccess: sinon.stub(),
      incrementSessionFailure: sinon.stub(),
      incrementHealingAttempt: sinon.stub(),
      incrementHealingSuccess: sinon.stub(),
      recordHealingLatency: sinon.stub(),
    } as any);
    Container.set(SelectorStateService, { onHealRecorded: sinon.stub().resolves(null) } as any);

    svc = Container.get(NotificationService);
    sent = [];
    sinon.stub(svc, 'dispatchEvent').callsFake((async (event: string, payload: any) => {
      sent.push({ event, payload });
    }) as any);
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  /** The webhooks are sent without being awaited: let them go out. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  const of = (event: string) => sent.filter((s) => s.event === event);
  const uniqueId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2)}`;

  describe('the payloads', () => {
    const row = {
      id: 's-1',
      name: 'Checkout flow',
      status: 'failed',
      failure_reason: 'no such element',
      device_udid: 'R58M123',
      device_name: 'Galaxy S9+',
      device_platform: 'android',
      device_version: '10',
      startTime: new Date('2026-11-12T09:00:00.000Z'),
      endTime: new Date('2026-11-12T09:02:30.500Z'),
      desired_capabilities: '{"appium:app":"/secret.apk"}',
      api_key_id: 'key-1',
      ai_analysis: 'Root cause: ...',
    };

    it('session_started: the session and its device, nothing from its capabilities', () => {
      const payload = sessionStartedPayload(row);
      expect(payload).to.deep.equal({
        sessionId: 's-1',
        sessionName: 'Checkout flow',
        udid: 'R58M123',
        deviceName: 'Galaxy S9+',
        platform: 'android',
        osVersion: '10',
        startTime: '2026-11-12T09:00:00.000Z',
      });
    });

    it('session_stopped: and how it ended, when, and for how long', () => {
      const payload = sessionStoppedPayload(row);
      expect(payload).to.deep.equal({
        sessionId: 's-1',
        sessionName: 'Checkout flow',
        status: 'failed',
        failureReason: 'no such element',
        udid: 'R58M123',
        deviceName: 'Galaxy S9+',
        platform: 'android',
        osVersion: '10',
        startTime: '2026-11-12T09:00:00.000Z',
        endTime: '2026-11-12T09:02:30.500Z',
        durationMs: 150_500,
      });
      expect(JSON.stringify(payload)).not.to.contain('secret.apk');
      expect(JSON.stringify(payload)).not.to.contain('key-1');
      expect(JSON.stringify(payload)).not.to.contain('Root cause');
    });

    it('session_stopped: unknown values are empty text, never missing', () => {
      const payload = sessionStoppedPayload({
        ...row,
        name: null,
        failure_reason: null,
        device_name: null,
        endTime: null,
      });
      expect(payload.sessionName).to.equal('');
      expect(payload.failureReason).to.equal('');
      expect(payload.deviceName).to.equal('');
      expect(payload.endTime).to.equal('');
      expect(payload.durationMs).to.equal('');
    });

    it('healing_event: the heal, its session and device', () => {
      const payload = healingEventPayload({
        sessionId: 's-1',
        udid: 'R58M123',
        deviceName: 'Galaxy S9+',
        platform: 'android',
        command: 'findElement',
        originalStrategy: 'xpath',
        originalSelector: "//*[@text='Log in']",
        healedStrategy: 'id',
        healedSelector: 'com.shop:id/login',
        tier: 'Fuzzy XML',
        confidence: 0.91,
        time: new Date('2026-11-12T09:01:00.000Z'),
      });
      expect(payload).to.deep.equal({
        sessionId: 's-1',
        udid: 'R58M123',
        deviceName: 'Galaxy S9+',
        platform: 'android',
        command: 'findElement',
        originalStrategy: 'xpath',
        originalSelector: "//*[@text='Log in']",
        healedStrategy: 'id',
        healedSelector: 'com.shop:id/login',
        tier: 'Fuzzy XML',
        confidence: 0.91,
        time: '2026-11-12T09:01:00.000Z',
      });
    });

    it('lists the three new events among the events a webhook can take', () => {
      expect(EVENT_TYPES).to.include.members([
        'session_started',
        'session_stopped',
        'healing_event',
      ]);
      for (const event of ['session_started', 'session_stopped', 'healing_event'] as const) {
        expect(WEBHOOK_EVENTS[event].when, event).to.be.a('string').and.not.equal('');
      }
    });
  });

  describe('session_stopped: sent where the session ends, for every outcome', () => {
    let row: { id: string };

    beforeEach(async () => {
      sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
      sinon
        .stub(DeviceStoreFactory, 'getStore')
        .returns({ getDevices: async () => [], findDevices: async () => [] } as any);
      const id = uniqueId('stop');
      await scratch.db.session.create({
        data: {
          id,
          name: 'Checkout flow',
          status: 'running',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node',
          has_live_video: false,
          device_udid: 'R58M123',
          device_name: 'Galaxy S9+',
          device_platform: 'android',
          device_version: '10',
          startTime: new Date(Date.now() - 60_000),
        },
      });
      row = { id };
    });

    const failedCommand = () =>
      scratch.db.sessionLog.create({
        data: {
          session_id: row.id,
          command_name: 'findElement',
          url: `/session/${row.id}/element`,
          method: 'POST',
          title: 'findElement',
          response: '{"value":{"error":"no such element"}}',
          is_error: true,
        },
      });
    const statusNow = async () =>
      (await scratch.db.session.findUniqueOrThrow({ where: { id: row.id } })).status;

    it('when the session passed', async () => {
      await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id);
      await settle();

      const [stopped] = of('session_stopped');
      expect(stopped.payload).to.include({
        sessionId: row.id,
        status: 'success',
        failureReason: '',
      });
      expect(stopped.payload.durationMs).to.be.a('number').and.be.at.least(59_000);
      expect(of('session_failed')).to.have.length(0);
    });

    it('when a command failed, beside session_failed', async () => {
      await failedCommand();

      await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id);
      await settle();

      expect(of('session_stopped').map((s) => s.payload.status)).to.deep.equal(['failed']);
      expect(of('session_stopped')[0].payload.failureReason).to.equal('no such element');
      expect(of('session_failed')).to.have.length(1);
    });

    it('when Xenon ended it with a status of its own', async () => {
      await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id, SessionStatus.TIMEOUT, 'idle');
      await settle();

      expect(of('session_stopped')[0].payload).to.include({
        status: 'timeout',
        failureReason: 'idle',
      });
    });

    it('once, when the session ends twice: a crash, then the client’s delete', async () => {
      await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id, SessionStatus.FAILED, 'crash');
      await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id);
      await settle();

      expect(of('session_stopped')).to.have.length(1);
    });

    it('not when the server itself is shutting down', async () => {
      await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id, SessionStatus.FAILED, 'Hub shutdown', {
        notify: false,
      });
      await settle();

      expect(await statusNow()).to.equal('failed');
      expect(of('session_stopped')).to.have.length(0);
    });

    it('lets no failed delivery escape: it is logged, never left unhandled', async () => {
      (svc.dispatchEvent as sinon.SinonStub).rejects(new Error('webhook store unreadable'));
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        await DASHBORD_EVENT_MANAGER.onSessionStopped(row.id);
        await settle();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
      expect(unhandled).to.deep.equal([]);
      expect(await statusNow()).to.equal('success');
    });

    it("doesn't hold the session's end up for a webhook that never answers", async () => {
      (svc.dispatchEvent as sinon.SinonStub).callsFake(() => new Promise(() => undefined));

      const ended = await Promise.race([
        DASHBORD_EVENT_MANAGER.onSessionStopped(row.id).then(() => 'ended'),
        new Promise((resolve) => setTimeout(() => resolve('waiting on the webhook'), 2_000)),
      ]);
      expect(ended).to.equal('ended');
    });
  });

  describe('session_started: sent once the session has its row', () => {
    const device = {
      udid: 'phone-w',
      platform: 'android',
      realDevice: true,
      host: 'h',
      name: 'Pixel 8',
      sdk: '14',
    };
    const sessionOf = (id: string) => ({
      getId: () => id,
      getCapabilities: () => ({ platformName: 'Android' }),
      getLiveVideoUrl: () => null,
      getType: () => 'remote',
      startPerformanceRecording: sinon.stub().resolves(),
      apiKeyId: null,
      userId: null,
    });

    const startStubs = () => {
      sinon.stub(assets, 'prepareDirectory');
      sinon.stub(TracingService.prototype, 'getTraceId').returns(undefined as any);
    };

    it('for a session the dashboard records', async () => {
      const id = uniqueId('start');
      startStubs();

      await DASHBORD_EVENT_MANAGER.onSessionStarted(
        { name: 'Login' } as any,
        sessionOf(id) as any,
        device as any,
      );
      await settle();

      const row = await scratch.db.session.findUniqueOrThrow({ where: { id } });
      expect(of('session_started').map((s) => s.payload)).to.deep.equal([
        {
          sessionId: id,
          sessionName: 'Login',
          udid: 'phone-w',
          deviceName: 'Pixel 8',
          platform: 'android',
          osVersion: '14',
          startTime: row.startTime.toISOString(),
        },
      ]);
    });

    it("not when the session's row couldn't be written", async () => {
      const id = uniqueId('start');
      startStubs();
      // A row of that id already there: the create is refused.
      await scratch.db.session.create({
        data: {
          id,
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node',
          has_live_video: false,
          device_udid: 'other',
          device_platform: 'android',
          device_version: '10',
        },
      });

      await DASHBORD_EVENT_MANAGER.onSessionStarted(
        {} as any,
        sessionOf(id) as any,
        device as any,
      ).catch(() => undefined);
      await settle();

      expect(of('session_started')).to.have.length(0);
    });

    it('for a session routed to a node, which gets a row of its own with the dashboard off', async () => {
      const id = uniqueId('routed');

      await (Container.get(SessionLifecycleService) as any).recordRoutedSession(
        {},
        sessionOf(id),
        device,
      );
      await settle();

      const row = await scratch.db.session.findUniqueOrThrow({ where: { id } });
      expect(of('session_started').map((s) => s.payload.sessionId)).to.deep.equal([id]);
      expect(of('session_started')[0].payload.startTime).to.equal(row.startTime.toISOString());
    });
  });

  describe('healing_event: sent where the heal is recorded', () => {
    const SESSION = 'heal-hook-session';

    beforeEach(async () => {
      sinon.stub(SESSION_MANAGER, 'getSession').returns({
        getId: () => SESSION,
        getDevice: () => ({ udid: 'heal-phone', name: 'Galaxy S9+', platform: 'android' }),
        getXenonOption: (_name: string, fallback: unknown) => fallback,
        getScreenShot: async () => '',
      } as any);
      await scratch.db.sessionLog.deleteMany({ where: { session_id: SESSION } });
      await scratch.db.session.deleteMany({ where: { id: SESSION } });
      await scratch.db.session.create({
        data: {
          id: SESSION,
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node',
          has_live_video: false,
          device_udid: 'heal-phone',
          device_platform: 'android',
          device_version: '10',
        },
      });
    });

    const record = (heal?: any) =>
      DASHBORD_EVENT_MANAGER.afterSessionCommand(
        SESSION,
        'findElement',
        null,
        {
          body: { using: 'xpath', value: "//*[@text='Log in']" },
          headers: {},
          method: 'POST',
          originalUrl: `/wd/hub/session/${SESSION}/element`,
        } as any,
        {} as any,
        JSON.stringify({ value: { ELEMENT: 'e-1' } }),
        heal,
      );

    it("a heal on this server's phone or a node's (both come with the command)", async () => {
      await record({
        originalSelector: "//*[@text='Log in']",
        originalStrategy: 'xpath',
        healedSelector: 'com.shop:id/login',
        healedStrategy: 'id',
        confidence: 0.91,
        tier: 2,
      });
      await settle();

      const [heal] = of('healing_event');
      expect(heal.payload).to.include({
        sessionId: SESSION,
        udid: 'heal-phone',
        deviceName: 'Galaxy S9+',
        platform: 'android',
        command: 'findElement',
        originalStrategy: 'xpath',
        originalSelector: "//*[@text='Log in']",
        healedStrategy: 'id',
        healedSelector: 'com.shop:id/login',
        confidence: 0.91,
      });
      expect(heal.payload.tier).to.be.a('string').and.not.equal('');
      expect(heal.payload.time).to.match(/^\d{4}-\d\d-\d\dT/);
    });

    it('not for a command that found its element without healing', async () => {
      await record();
      await settle();

      expect(of('healing_event')).to.have.length(0);
    });
  });

  describe('delivery', () => {
    it(`gives every webhook ${WEBHOOK_TIMEOUT_MS / 1000} s to answer, in every format`, async () => {
      (svc.dispatchEvent as sinon.SinonStub).restore();
      const post = sinon.stub(axios, 'post').resolves({ status: 200 });
      sinon.stub(svc, 'getConfigs').resolves([
        {
          id: 'a',
          url: 'https://a.example',
          events: '["session_stopped"]',
          type: 'slack',
          active: true,
        },
        {
          id: 'b',
          url: 'https://b.example',
          events: '["session_stopped"]',
          type: 'generic',
          active: true,
        },
        {
          id: 'c',
          url: 'https://c.example',
          events: '["session_stopped"]',
          type: 'generic',
          payloadTemplate: '{"s":"{{sessionId}}"}',
          active: true,
        },
      ] as any);

      await svc.dispatchEvent('session_stopped', WEBHOOK_EVENTS.session_stopped.sample());

      expect(post.callCount).to.equal(3);
      for (const call of post.getCalls()) {
        expect(call.args[2], call.args[0]).to.deep.include({ timeout: WEBHOOK_TIMEOUT_MS });
      }
      expect(WEBHOOK_TIMEOUT_MS).to.equal(10_000);
    });
  });
});
