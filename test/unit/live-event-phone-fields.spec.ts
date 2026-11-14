import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { saveRegistrations } from '../helpers/container-registration';
import { useArtifactStore } from '../helpers/artifact-store';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { DashboardCommands } from '../../src/dashboard/commands';
import * as assets from '../../src/dashboard/asset-manager';
import * as sessionService from '../../src/dashboard/services/session-service';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SocketServer } from '../../src/services/SocketServer';
import { SocketEvents } from '../../src/enums/SocketEvents';
import { NotificationService } from '../../src/services/NotificationService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { TracingService } from '../../src/services/TracingService';
import { MetricsService } from '../../src/services/MetricsService';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import { InterceptorService } from '../../src/services/InterceptorService';
import { PortAllocator } from '../../src/services/PortAllocator';
import { BugReportService } from '../../src/services/bug-report/BugReportService';
import bugReportRouter from '../../src/app/routers/bug-report';
import log from '../../src/logger';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';

/**
 * Two servers can each have an emulator-5554. Every live event about a phone
 * names which one it is (its host), and is scoped by that exact phone, so
 * the dashboard and the team rule can tell them apart.
 */
const E = 'emulator-5554';
const H1 = 'http://h1:4723';
const H2 = 'http://h2:4723';

describe('live events name their phone by udid and host', () => {
  let restore: () => void;
  let socket: {
    emitToDashboard: sinon.SinonStub;
    emitToDashboardForDevices: sinon.SinonStub;
    hasScopedDashboard: sinon.SinonStub;
  };
  const calls = (event: string) =>
    socket.emitToDashboardForDevices.getCalls().filter((c) => c.args[0] === event);
  const tick = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    restore = saveRegistrations(
      SocketServer,
      NotificationService,
      SessionMetricsService,
      SessionDeviceLogs,
      RecordingStore,
      PortAllocator,
    );
    socket = {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      // A member is connected, so emitters look their phone up.
      hasScopedDashboard: sinon.stub().returns(true),
    };
    Container.set(SocketServer, socket as any);
    Container.set(NotificationService, {
      notifySessionStarted: async () => undefined,
      notifySessionStopped: async () => undefined,
      notifySessionFailed: async () => undefined,
      notifyHeal: async () => undefined,
      dispatchEvent: () => undefined,
    } as any);
    Container.set(SessionMetricsService, {
      appliesTo: () => false,
      start: sinon.stub(),
      stop: sinon.stub().resolves(),
    } as any);
    Container.set(SessionDeviceLogs, {
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
      noteOff: sinon.stub().resolves(),
    } as any);
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  /** A store whose rows of E are on two servers. */
  function stubStore(rows: any[]) {
    const findDevices = sinon.spy(async (filter: any) =>
      rows.filter(
        (r) =>
          (filter.udid === undefined || r.udid === filter.udid) &&
          (filter.host === undefined || r.host === filter.host),
      ),
    );
    sinon.stub(DeviceStoreFactory, 'getStore').returns({ findDevices } as any);
    return findDevices;
  }

  describe('sessions', () => {
    it("session_started: the record names its phone's host, and is scoped by it", async () => {
      sinon.stub(assets, 'prepareDirectory');
      sinon.stub(sessionService, 'getOrCreateNewBuild').resolves({ id: 'b1' } as any);
      sinon.stub(TracingService.prototype, 'getTraceId').returns('t-1' as any);
      sinon.stub(MetricsService.prototype, 'incrementSessionStart');
      const create = sinon.stub(prisma.session as any, 'create').resolves({ id: 's1' } as any);
      const session = {
        getId: () => 's1',
        getCapabilities: () => ({ platformName: 'Android' }),
        getLiveVideoUrl: () => null,
        apiKeyId: null,
        userId: null,
      };
      const device = { udid: E, host: H2, platform: 'android', name: 'Pixel', sdk: '14' };

      await DASHBORD_EVENT_MANAGER.onSessionStarted({}, session as any, device as any);

      const [call] = calls(SocketEvents.SESSION_STARTED);
      expect(call.args[1]).to.include({ device_udid: E, device_host: H2 });
      expect(call.args[2]).to.deep.equal({ udid: E, host: H2 });
      // The Session table has no host column: the row is written without one.
      expect(create.firstCall.args[0].data).to.not.have.property('device_host');
    });

    it("session_command and healing_event: the session's phone, by host", async () => {
      sinon.stub(SESSION_MANAGER, 'getSession').returns({
        getId: () => 's2',
        getDevice: () => ({ udid: E, host: H2, name: 'Pixel', platform: 'android' }),
        getXenonOption: () => undefined,
        getScreenShot: async () => '',
      } as any);
      sinon
        .stub(prisma.sessionLog, 'create' as any)
        .resolves({ id: 'l1', createdAt: new Date() } as any);
      sinon.stub(SelectorStateService.prototype, 'onHealRecorded').resolves(null);

      await DASHBORD_EVENT_MANAGER.afterSessionCommand(
        's2',
        'findElement',
        null,
        { body: ['xpath', '//x'], method: 'POST', originalUrl: '/element' } as any,
        {} as any,
        JSON.stringify({ value: { ELEMENT: 'e' } }),
        { originalSelector: '//x', healedSelector: 'y', confidence: 0.9, tier: 1 },
      );
      await tick();

      expect(calls(SocketEvents.SESSION_COMMAND)[0].args[2]).to.deep.equal({ udid: E, host: H2 });
      const [heal] = calls(SocketEvents.HEALING_EVENT);
      expect(heal.args[1]).to.include({ deviceUdid: E, deviceHost: H2 });
      expect(heal.args[2]).to.deep.equal({ udid: E, host: H2 });
    });

    describe('session_stopped', () => {
      beforeEach(() => {
        sinon.stub(deviceService, 'releaseSessionDevices').resolves();
        sinon.stub(prisma.session, 'update').resolves({} as any);
        sinon.stub(prisma.sessionLog, 'findFirst').resolves(null);
      });

      it('the phone the session holds in SESSION_MANAGER, payload unchanged', async () => {
        sinon.stub(SESSION_MANAGER, 'getSession').returns({
          getDevice: () => ({ udid: E, host: H2 }),
        } as any);
        const findDevices = stubStore([]);
        sinon
          .stub(prisma.session, 'findFirst')
          .resolves({ id: 's3', status: 'running', device_udid: E, node_id: 'n1' } as any);

        await DASHBORD_EVENT_MANAGER.onSessionStopped('s3');

        const [call] = calls(SocketEvents.SESSION_STOPPED);
        expect(call.args[1]).to.deep.equal({
          id: 's3',
          status: 'success',
          failure_reason: undefined,
        });
        expect(call.args[2]).to.deep.equal({ udid: E, host: H2 });
        expect(findDevices.called, 'the phone in hand needs no lookup').to.equal(false);
      });

      it("else the Device row of the session's udid on the session's node", async () => {
        sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
        stubStore([
          { udid: E, host: H1, nodeId: 'n1' },
          { udid: E, host: H2, nodeId: 'n2' },
        ]);
        sinon
          .stub(prisma.session, 'findFirst')
          .resolves({ id: 's4', status: 'running', device_udid: E, node_id: 'n2' } as any);

        await DASHBORD_EVENT_MANAGER.onSessionStopped('s4');

        expect(calls(SocketEvents.SESSION_STOPPED)[0].args[2]).to.deep.equal({
          udid: E,
          host: H2,
        });
      });

      it('no such row: the udid alone (two rows of it then reach admins only)', async () => {
        sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
        stubStore([
          { udid: E, host: H1, nodeId: 'n1' },
          { udid: E, host: H2, nodeId: 'n2' },
        ]);
        sinon
          .stub(prisma.session, 'findFirst')
          .resolves({ id: 's5', status: 'running', device_udid: E, node_id: 'gone' } as any);

        await DASHBORD_EVENT_MANAGER.onSessionStopped('s5');

        expect(calls(SocketEvents.SESSION_STOPPED)[0].args[2]).to.deep.equal({ udid: E });
      });

      it('with no scoped dashboard connected: no Device lookup', async () => {
        socket.hasScopedDashboard.returns(false);
        sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
        const findDevices = stubStore([{ udid: E, host: H2, nodeId: 'n2' }]);
        sinon
          .stub(prisma.session, 'findFirst')
          .resolves({ id: 's6', status: 'running', device_udid: E, node_id: 'n2' } as any);

        await DASHBORD_EVENT_MANAGER.onSessionStopped('s6');

        expect(findDevices.called).to.equal(false);
        expect(calls(SocketEvents.SESSION_STOPPED)[0].args[2]).to.deep.equal({ udid: E });
      });
    });

    it("xenon: setSessionStatus: the updated session's phone on its node", async () => {
      sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
      stubStore([
        { udid: E, host: H1, nodeId: 'n1' },
        { udid: E, host: H2, nodeId: 'n2' },
      ]);
      sinon.stub(prisma.session, 'findUnique').resolves({ id: 's7', tags: null } as any);
      sinon
        .stub(prisma.session, 'update')
        .resolves({ id: 's7', device_udid: E, node_id: 'n1' } as any);
      const res: any = { status: () => res, json: () => res };

      await new DashboardCommands().process(
        's7',
        { body: { script: 'xenon: setSessionStatus', args: [{ status: 'failed' }] } } as any,
        res,
      );

      expect(calls(SocketEvents.SESSION_STOPPED)[0].args[2]).to.deep.equal({ udid: E, host: H1 });
    });

    it("bug_report_generated: the session's phone on its node", async () => {
      sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
      stubStore([
        { udid: E, host: H1, nodeId: 'n1' },
        { udid: E, host: H2, nodeId: 'n2' },
      ]);
      sinon.stub(BugReportService.prototype, 'assemble').resolves({
        filename: 'b.zip',
        manifest: { warnings: [], device: { udid: E } } as any,
        entries: [{ name: 'a.txt', source: { kind: 'buffer', data: Buffer.from('hi') } }],
        cleanup: async () => {},
      } as any);
      sinon
        .stub(prisma.session, 'findUnique')
        .resolves({ device_udid: E, user_id: null, node_id: 'n2' } as any);
      const app = express();
      app.use((req: any, _res, next) => {
        req.auth = {
          kind: 'user-session',
          userId: 'u1',
          role: 'ADMIN',
          scopes: 'admin,devices,sessions,read',
          teamIds: undefined,
        };
        next();
      });
      bugReportRouter.register(app as any);

      await request(app)
        .post('/sessions/s8/bug-report?mode=full')
        .buffer(true)
        .parse((r, cb) => {
          r.on('data', () => undefined);
          r.on('end', () => cb(null, null));
        });
      for (let i = 0; i < 5 && calls(SocketEvents.BUG_REPORT_GENERATED).length === 0; i++) {
        await tick();
      }

      expect(calls(SocketEvents.BUG_REPORT_GENERATED)[0].args[2]).to.deep.equal({
        udid: E,
        host: H2,
      });
    });
    it('bug_report_generated: a send that fails is logged, never left unhandled', async () => {
      sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
      stubStore([{ udid: E, host: H1, nodeId: 'n1' }]);
      sinon.stub(BugReportService.prototype, 'assemble').resolves({
        filename: 'b.zip',
        manifest: { warnings: [], device: { udid: E } } as any,
        entries: [{ name: 'a.txt', source: { kind: 'buffer', data: Buffer.from('hi') } }],
        cleanup: async () => {},
      } as any);
      sinon
        .stub(prisma.session, 'findUnique')
        .resolves({ device_udid: E, user_id: null, node_id: 'n1' } as any);
      socket.emitToDashboardForDevices.rejects(new Error('socket gone'));
      const warn = sinon.stub(log, 'warn');
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      const mochaHandlers = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      process.on('unhandledRejection', onUnhandled);
      try {
        const app = express();
        app.use((req: any, _res, next) => {
          req.auth = {
            kind: 'user-session',
            userId: 'u1',
            role: 'ADMIN',
            scopes: 'admin,devices,sessions,read',
            teamIds: undefined,
          };
          next();
        });
        bugReportRouter.register(app as any);

        await request(app)
          .post('/sessions/s9/bug-report?mode=full')
          .buffer(true)
          .parse((r, cb) => {
            r.on('data', () => undefined);
            r.on('end', () => cb(null, null));
          });
        for (let i = 0; i < 10 && calls(SocketEvents.BUG_REPORT_GENERATED).length === 0; i++) {
          await tick();
        }
        for (let i = 0; i < 5; i++) await tick();
      } finally {
        process.removeListener('unhandledRejection', onUnhandled);
        for (const h of mochaHandlers) process.on('unhandledRejection', h as any);
      }

      expect(calls(SocketEvents.BUG_REPORT_GENERATED)).to.have.length(1);
      expect(unhandled, 'the failed send must be caught').to.deep.equal([]);
      expect(warn.calledWithMatch(sinon.match(/\[BugReport\] broadcast failed: socket gone/))).to.be
        .true;
    });
  });

  describe('recordings', () => {
    useArtifactStore();

    function rowStore() {
      const rows: any[] = [];
      return {
        rows,
        create: sinon.stub().callsFake(async (i: any) => {
          rows.push({
            id: i.id,
            group_id: i.groupId,
            device_udid: i.deviceUdid,
            device_host: i.deviceHost,
            file_path: i.filePath,
            started_at: new Date().toISOString(),
            status: 'RECORDING',
          });
          return i;
        }),
        finalize: sinon.stub().resolves({}),
        listActive: sinon.stub().resolves([]),
        listGroup: sinon.stub().callsFake(async () => rows),
      };
    }

    function orchestrator(startRecording: sinon.SinonStub) {
      return new RecordingOrchestrator({
        busyPrecheck: { findBusy: sinon.stub().resolves([]) } as any,
        store: rowStore() as any,
        gate: new ConcurrencyGate(4) as any,
        videoPipeline: {
          startRecording,
          stopRecording: sinon.stub().resolves('/tmp/x.mp4'),
          startComposite: sinon.stub().resolves({ cellW: 540, cellH: 960, cols: 2, rows: 1 }),
          stopComposite: sinon.stub().resolves(null),
        } as any,
        // The real event manager, so what reaches the socket is checked.
        eventMgr: DASHBORD_EVENT_MANAGER,
        blockDeviceFn: sinon.stub().resolves(),
        unblockDeviceFn: sinon.stub().resolves(),
        ensureMjpegPortFn: sinon.stub().resolves(9100),
        nodeSourceFn: sinon
          .stub()
          .callsFake(async (phone: any) =>
            phone.host === H2 ? { port: 5555, close: async () => undefined } : null,
          ),
        leaveDeviceFn: sinon.stub(),
        probeDurationMsFn: async () => 1000,
      });
    }

    const phones = [
      { udid: E, host: H1 },
      { udid: E, host: H2 },
    ];

    it('recording_started and recording_stopped: each recording names its host, scoped by both phones', async () => {
      const orch = orchestrator(sinon.stub().resolves());

      const { groupId } = await orch.start({ phones, actorId: 'u1' });
      await orch.stop(groupId);

      for (const event of [SocketEvents.RECORDING_STARTED, SocketEvents.RECORDING_STOPPED]) {
        const [call] = calls(event);
        expect(
          call.args[1].recordings.map((r: any) => ({ udid: r.udid, host: r.host })),
          event,
        ).to.deep.equal(phones);
        const scope = call.args[2];
        expect(scope.phones, event).to.deep.equal(phones);
        // A socket that sees only h2's phone gets h2's recording alone.
        const cut = scope.strip(call.args[1], [{ udid: E, host: H2 }]);
        expect(
          cut.recordings.map((r: any) => r.host),
          event,
        ).to.deep.equal([H2]);
        expect(call.args[1].recordings, 'strip copies').to.have.length(2);
      }
    });

    it('recording_failed: names its host and is scoped by it', async () => {
      const startRecording = sinon.stub().callsFake(async (input: any) => {
        if (input.mjpegPort === 5555) throw new Error('spawn failed');
      });
      const orch = orchestrator(startRecording);

      await orch.start({ phones, actorId: 'u1' });

      const [failed] = calls(SocketEvents.RECORDING_FAILED);
      expect(failed.args[1]).to.include({ udid: E, host: H2 });
      expect(failed.args[2]).to.deep.equal({ udid: E, host: H2 });
      const [started] = calls(SocketEvents.RECORDING_STARTED);
      expect(started.args[1].recordings.map((r: any) => r.host)).to.deep.equal([H1]);
      expect(started.args[2].phones).to.deep.equal([{ udid: E, host: H1 }]);
    });

    it('add-device: recording_started names the added phone by host', async () => {
      const orch = orchestrator(sinon.stub().resolves());
      sinon.stub(orch as any, 'groupT0Ms').resolves(undefined);

      await orch.addDevice('grp', { udid: E, host: H2 }, 'u1');

      const [call] = calls(SocketEvents.RECORDING_STARTED);
      expect(call.args[1].recordings.map((r: any) => r.host)).to.deep.equal([H2]);
      expect(call.args[2].phones).to.deep.equal([{ udid: E, host: H2 }]);
    });

    it("a bookmark and an annotation: their recording's own udid and host", async () => {
      Container.set(RecordingStore, {
        findVideo: async (id: string) =>
          id === 'rec-h2' ? { id, device_udid: E, device_host: H2 } : null,
      } as any);

      DASHBORD_EVENT_MANAGER.emitRecordingBookmark({
        groupId: 'g',
        bookmark: { id: 'b', recording_id: 'rec-h2' },
      });
      DASHBORD_EVENT_MANAGER.emitRecordingAnnotation({
        groupId: 'g',
        annotation: { id: 'a', recording_id: 'rec-h2' },
      });
      await tick();

      expect(calls(SocketEvents.RECORDING_BOOKMARK_ADDED)[0].args[2]).to.deep.equal({
        udid: E,
        host: H2,
      });
      expect(calls(SocketEvents.RECORDING_ANNOTATION_ADDED)[0].args[2]).to.deep.equal({
        udid: E,
        host: H2,
      });
    });
  });

  describe('interceptor', () => {
    let dir: string;
    let assetsPath: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-live-event-host-'));
      assetsPath = config.sessionAssetsPath;
      config.sessionAssetsPath = dir;
    });
    afterEach(() => {
      config.sessionAssetsPath = assetsPath;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("request, started and stopped: scoped by the session's phone and its host, admins only", async () => {
      const svc = new InterceptorService();
      Container.set(PortAllocator, { release: async () => undefined } as any);
      (svc as any).androidAdapter = {
        clearProxy: async () => undefined,
        removeReverse: async () => undefined,
      };
      const device = { udid: E, host: H2 };
      (svc as any).states.set('s9', {
        sessionId: 's9',
        device,
        port: 1,
        host: '127.0.0.1',
        proxy: { stop: async () => undefined },
        mocks: { list: () => [] },
        buffer: { list: () => [], clear: () => undefined },
        startedAt: 0,
      });
      (svc as any).emit({ type: 'request', sessionId: 's9', payload: { id: 'q1' } }, device);
      (svc as any).emit(
        { type: 'session_started', sessionId: 's9', port: 1, host: '127.0.0.1' },
        device,
      );
      await svc.stop('s9');

      const scope = { udid: E, host: H2, adminOnly: true };
      expect(calls(SocketEvents.INTERCEPTOR_REQUEST)[0].args[2]).to.deep.equal(scope);
      const [started] = calls(SocketEvents.INTERCEPTOR_SESSION_STARTED);
      // Its `host` is the capture proxy's, not the phone's, and stays so.
      expect(started.args[1]).to.deep.equal({ sessionId: 's9', host: '127.0.0.1', port: 1 });
      expect(started.args[2]).to.deep.equal(scope);
      expect(calls(SocketEvents.INTERCEPTOR_SESSION_STOPPED)[0].args[2]).to.deep.equal(scope);
    });
  });
});
