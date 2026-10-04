import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import { SocketServer } from '../../src/services/SocketServer';
import { SocketEvents } from '../../src/enums/SocketEvents';
import { DeviceTeamResolver } from '../../src/services/device-access/DeviceTeamResolver';
import { NotificationService } from '../../src/services/NotificationService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { DashboardCommands } from '../../src/dashboard/commands';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { InterceptorService } from '../../src/services/InterceptorService';
import { PortAllocator } from '../../src/services/PortAllocator';
import { BugReportService } from '../../src/services/bug-report/BugReportService';
import bugReportRouter from '../../src/app/routers/bug-report';
import GridRouter from '../../src/app/routers/grid';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * Each emitter names the phone its event is about. These pin where each one
 * takes the udid from, since a wrong or missing udid doesn't fail loudly: it
 * fails closed, and members silently stop getting the event.
 */
describe('Dashboard events name their phone (team-scoped call sites)', () => {
  let restore: () => void;
  let socket: {
    emitToDashboard: sinon.SinonStub;
    emitToDashboardForDevices: sinon.SinonStub;
    hasScopedDashboard: sinon.SinonStub;
  };
  let lookups: string[];
  let teams: Record<string, string | null>;

  const scoped = (event: string) =>
    socket.emitToDashboardForDevices.getCalls().filter((c) => c.args[0] === event);

  beforeEach(() => {
    restore = saveRegistrations(
      SocketServer,
      DeviceTeamResolver,
      NotificationService,
      PortAllocator,
      RecordingStore,
    );
    socket = {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      // A member is connected, so the call sites look phones up.
      hasScopedDashboard: sinon.stub().returns(true),
    };
    Container.set(SocketServer, socket as any);
    Container.set(NotificationService, { dispatchEvent: () => undefined } as any);
    lookups = [];
    teams = { 'phone-a': 'team-a', 'phone-b': 'team-b' };
    Container.set(
      DeviceTeamResolver,
      new DeviceTeamResolver({
        findDevice: async (udid: string) => {
          lookups.push(udid);
          return udid in teams ? { teamId: teams[udid] } : null;
        },
      }),
    );
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  describe('event manager', () => {
    it('session_command and healing_event: the session device', async () => {
      sinon.stub(SESSION_MANAGER, 'getSession').returns({
        getId: () => 's1',
        getDevice: () => ({ udid: 'phone-b', name: 'P', platform: 'android' }),
        getXenonOption: () => undefined,
        getScreenShot: async () => '',
      } as any);
      sinon
        .stub(prisma.sessionLog, 'create' as any)
        .resolves({ id: 'l1', createdAt: new Date() } as any);
      sinon.stub(SelectorStateService.prototype, 'onHealRecorded').resolves(null);
      await DASHBORD_EVENT_MANAGER.afterSessionCommand(
        's1',
        'findElement',
        null,
        { body: ['xpath', '//x'], method: 'POST', originalUrl: '/element' } as any,
        {} as any,
        JSON.stringify({ value: { ELEMENT: 'e' } }),
        { originalSelector: '//x', healedSelector: 'y', confidence: 0.9, tier: 1 },
      );
      expect(scoped(SocketEvents.SESSION_COMMAND)[0].args[2]).to.deep.equal({ udid: 'phone-b' });
      expect(scoped(SocketEvents.HEALING_EVENT)[0].args[2]).to.deep.equal({ udid: 'phone-b' });
      expect(socket.emitToDashboard.called, 'no unscoped session event').to.equal(false);
      await new Promise((r) => setImmediate(r));
    });

    it("session_stopped: the stored session's device_udid, with the payload unchanged", async () => {
      sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
      sinon.stub(DeviceStoreFactory, 'getStore').returns({ getDevices: async () => [] } as any);
      sinon
        .stub(prisma.session, 'findFirst')
        .resolves({ id: 's2', status: 'running', device_udid: 'phone-a' } as any);
      sinon.stub(prisma.session, 'update').resolves({} as any);
      sinon.stub(prisma.sessionLog, 'findFirst').resolves(null);
      await DASHBORD_EVENT_MANAGER.onSessionStopped('s2');
      const [call] = scoped(SocketEvents.SESSION_STOPPED);
      expect(call.args[1]).to.deep.equal({
        id: 's2',
        status: 'success',
        failure_reason: undefined,
      });
      expect(call.args[2]).to.deep.equal({ udid: 'phone-a' });
    });

    it('recording_started / recording_stopped: every phone, stripped per socket', () => {
      const started = {
        groupId: 'g',
        recordings: [
          { id: 'r1', udid: 'phone-a' },
          { id: 'r2', udid: 'phone-b' },
        ],
        startedAt: new Date(),
      };
      DASHBORD_EVENT_MANAGER.emitRecordingStarted(started);
      DASHBORD_EVENT_MANAGER.emitRecordingStopped({
        groupId: 'g',
        recordings: [
          { id: 'r1', udid: 'phone-a', status: 'COMPLETED' },
          { id: 'r2', udid: 'phone-b', status: 'COMPLETED' },
        ],
      });
      for (const event of [SocketEvents.RECORDING_STARTED, SocketEvents.RECORDING_STOPPED]) {
        const [call] = scoped(event);
        const scope = call.args[2];
        expect(scope.udids, event).to.deep.equal(['phone-a', 'phone-b']);
        const cut = scope.strip(call.args[1], ['phone-b']);
        expect(cut.groupId).to.equal('g');
        expect(cut.recordings.map((r: any) => r.id)).to.deep.equal(['r2']);
        expect(call.args[1].recordings, 'strip copies, never mutates').to.have.length(2);
      }
      expect(scoped(SocketEvents.RECORDING_STARTED)[0].args[1].startedAt).to.equal(
        started.startedAt,
      );
    });

    it('recording_failed: its own udid', () => {
      DASHBORD_EVENT_MANAGER.emitRecordingFailed({
        groupId: 'g',
        recordingId: 'r',
        udid: 'phone-b',
        reason: 'x',
      });
      expect(scoped(SocketEvents.RECORDING_FAILED)[0].args[2]).to.deep.equal({ udid: 'phone-b' });
    });

    it("bookmark and annotation: their recording's device", async () => {
      const find = sinon.spy(async (id: string) =>
        id === 'rec-1' ? { id, device_udid: 'phone-a' } : null,
      );
      Container.set(RecordingStore, { findVideo: find } as any);
      DASHBORD_EVENT_MANAGER.emitRecordingBookmark({
        groupId: 'g',
        bookmark: { id: 'b', recording_id: 'rec-1' },
      });
      DASHBORD_EVENT_MANAGER.emitRecordingAnnotation({
        groupId: 'g',
        annotation: { id: 'a', recording_id: 'rec-1' },
      });
      DASHBORD_EVENT_MANAGER.emitRecordingBookmark({
        groupId: 'g',
        bookmark: { id: 'b2', recording_id: 'gone' },
      });
      await new Promise((r) => setImmediate(r));
      const b = scoped(SocketEvents.RECORDING_BOOKMARK_ADDED);
      expect(b.map((c) => c.args[2])).to.deep.equal([{ udid: 'phone-a' }, { udid: undefined }]);
      expect(b[0].args[1]).to.deep.equal({
        groupId: 'g',
        bookmark: { id: 'b', recording_id: 'rec-1' },
      });
      expect(scoped(SocketEvents.RECORDING_ANNOTATION_ADDED)[0].args[2]).to.deep.equal({
        udid: 'phone-a',
      });
      expect(find.firstCall.args[0]).to.equal('rec-1');
    });

    it('marks with no scoped dashboard connected: sent at once, with no recording lookup', () => {
      socket.hasScopedDashboard.returns(false);
      const find = sinon.spy(async () => ({ device_udid: 'phone-a' }));
      Container.set(RecordingStore, { findVideo: find } as any);
      DASHBORD_EVENT_MANAGER.emitRecordingBookmark({
        groupId: 'g',
        bookmark: { recording_id: 'r' },
      });
      DASHBORD_EVENT_MANAGER.emitRecordingAnnotation({
        groupId: 'g',
        annotation: { recording_id: 'r' },
      });
      expect(find.called).to.equal(false);
      expect(scoped(SocketEvents.RECORDING_BOOKMARK_ADDED)).to.have.length(1);
      expect(scoped(SocketEvents.RECORDING_ANNOTATION_ADDED)).to.have.length(1);
    });

    it('a bookmark whose recording lookup fails is still sent, to admins only', async () => {
      Container.set(RecordingStore, {
        findVideo: async () => Promise.reject(new Error('db down')),
      } as any);
      DASHBORD_EVENT_MANAGER.emitRecordingBookmark({
        groupId: 'g',
        bookmark: { recording_id: 'rec-1' },
      });
      await new Promise((r) => setImmediate(r));
      expect(scoped(SocketEvents.RECORDING_BOOKMARK_ADDED)[0].args[2]).to.deep.equal({
        udid: undefined,
      });
    });
  });

  describe('device-service', () => {
    let store: Record<string, sinon.SinonStub>;
    let restoreStorage: () => void;
    beforeEach(() => {
      // unblock records utilization in LocalStorage; give it a sink.
      restoreStorage = saveRegistrations('LocalStorage');
      Container.set('LocalStorage', { getItem: () => null, setItem: () => undefined });
      store = {
        addDevices: sinon
          .stub()
          .callsFake(async (rows: any[]) =>
            rows.map((r) => ({ ...r, teamId: teams[r.udid] ?? null })),
          ),
        // Deletes for real from the rows the resolver reads, so a team read
        // after the delete finds nothing.
        removeDevices: sinon.stub().callsFake(async (filter: { udid: string }) => {
          delete teams[filter.udid];
        }),
        updateDevice: sinon.stub().resolves(),
        // removeDevice reads the row for the device_offline webhook's name and platform.
        findDevice: sinon.stub().resolves(null),
        getDevices: sinon.stub().resolves([
          {
            udid: 'phone-b',
            host: 'h',
            teamId: 'team-b',
            sessionStartTime: 0,
            totalUtilizationTimeMilliSec: 0,
          },
        ]),
      };
      sinon.stub(DeviceStoreFactory, 'getStore').returns(store as any);
    });

    afterEach(() => restoreStorage());

    it("device_added: the stored row's own team, no lookup", async () => {
      await deviceService.addNewDevice([{ udid: 'phone-b', host: 'h' } as any]);
      expect(scoped('device_added')[0].args[2]).to.deep.equal({
        udid: 'phone-b',
        teamId: 'team-b',
      });
      expect(lookups).to.deep.equal([]);
    });

    it('device_removed: the team is read before the row is deleted', async () => {
      await deviceService.removeDevice([{ udid: 'phone-b', host: 'h' }]);
      expect(lookups).to.deep.equal(['phone-b']);
      expect(store.removeDevices.calledOnce).to.equal(true);
      expect(scoped('device_removed')[0].args[2]).to.deep.equal({
        udid: 'phone-b',
        teamId: 'team-b',
      });
    });

    it('device_removed with no scoped dashboard connected: no team read at all', async () => {
      socket.hasScopedDashboard.returns(false);
      await deviceService.removeDevice([{ udid: 'phone-b', host: 'h' }]);
      expect(lookups).to.deep.equal([]);
      expect(scoped('device_removed')[0].args[2]).to.deep.equal({ udid: 'phone-b' });
    });

    it('device_removed for a phone the store never had: no team, so it fails closed', async () => {
      await deviceService.removeDevice([{ udid: 'ghost', host: 'h' }]);
      expect(scoped('device_removed')[0].args[2]).to.deep.equal({ udid: 'ghost' });
    });

    it('device_progress and device_blocked: the udid, through the resolver', async () => {
      await deviceService.updateDeviceProgress('phone-a', 'h', 'installing');
      await deviceService.blockDevice('phone-a', 'h', 'sess-1');
      expect(scoped('device_progress')[0].args[2]).to.deep.equal({ udid: 'phone-a' });
      expect(scoped('device_blocked')[0].args[2]).to.deep.equal({ udid: 'phone-a' });
    });

    it("device_unblocked: the row's own team", async () => {
      await deviceService.unblockDeviceMatchingFilter({ udid: 'phone-b' });
      expect(scoped('device_unblocked')[0].args[2]).to.deep.equal({
        udid: 'phone-b',
        teamId: 'team-b',
      });
    });
  });

  it("xenon: setSessionStatus: the updated session's device", async () => {
    sinon.stub(prisma.session, 'update').resolves({ id: 's3', device_udid: 'phone-b' } as any);
    const res: any = { status: () => res, json: () => res };
    await new DashboardCommands().process(
      's3',
      {
        body: { script: 'xenon: setSessionStatus', args: [{ status: 'failed', reason: 'boom' }] },
      } as any,
      res,
    );
    const [call] = scoped(SocketEvents.SESSION_STOPPED);
    expect(call.args[1]).to.deep.equal({ id: 's3', status: 'failed', failure_reason: undefined });
    expect(call.args[2]).to.deep.equal({ udid: 'phone-b' });
  });

  describe('interceptor', () => {
    let dir: string;
    let assets: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-interceptor-scope-'));
      assets = config.sessionAssetsPath;
      config.sessionAssetsPath = dir;
    });
    afterEach(() => {
      config.sessionAssetsPath = assets;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("request, started and stopped: the session's device, even after stop() drops the state", async () => {
      const svc = new InterceptorService();
      Container.set(PortAllocator, { releaseForUdid: async () => undefined } as any);
      (svc as any).androidAdapter = {
        clearProxy: async () => undefined,
        removeReverse: async () => undefined,
      };
      (svc as any).states.set('s4', {
        sessionId: 's4',
        device: { udid: 'phone-a' },
        port: 1,
        host: 'h',
        proxy: { stop: async () => undefined },
        mocks: { list: () => [] },
        buffer: { list: () => [], clear: () => undefined },
        reverseEstablished: false,
        startedAt: 0,
      });
      (svc as any).emit({ type: 'request', sessionId: 's4', payload: { id: 'q1' } }, 'phone-a');
      (svc as any).emit(
        { type: 'session_started', sessionId: 's4', port: 1, host: 'h' },
        'phone-a',
      );
      await svc.stop('s4');
      expect(scoped(SocketEvents.INTERCEPTOR_REQUEST)[0].args.slice(1)).to.deep.equal([
        { id: 'q1' },
        { udid: 'phone-a' },
      ]);
      expect(scoped(SocketEvents.INTERCEPTOR_SESSION_STARTED)[0].args[2]).to.deep.equal({
        udid: 'phone-a',
      });
      expect(scoped(SocketEvents.INTERCEPTOR_SESSION_STOPPED)[0].args.slice(1)).to.deep.equal([
        { sessionId: 's4' },
        { udid: 'phone-a' },
      ]);
    });
  });

  it("bug_report_generated: to the dashboards that see the session's phone, never broadcast", async () => {
    sinon.stub(BugReportService.prototype, 'assemble').resolves({
      filename: 'b.zip',
      manifest: { warnings: [], device: { udid: 'phone-b' } } as any,
      entries: [{ name: 'a.txt', source: { kind: 'buffer', data: Buffer.from('hi') } }],
      cleanup: async () => {},
    } as any);
    // The route looks the session up first. No row: it assembles as before.
    // Unstubbed, that read the developer's database, and hung without it.
    sinon.stub(prisma.session, 'findUnique').resolves(null);
    const app = express();
    app.use((req: any, _res, next) => {
      req.auth = {
        kind: 'user-session',
        userId: 'u1',
        role: 'MEMBER',
        scopes: 'devices,sessions,read',
        teamIds: [],
      };
      next();
    });
    bugReportRouter.register(app as any);
    await request(app)
      .post('/sessions/s5/bug-report?mode=full')
      .buffer(true)
      .parse((r, cb) => {
        r.on('data', () => undefined);
        r.on('end', () => cb(null, null));
      });
    await new Promise((r) => setImmediate(r));
    expect(socket.emitToDashboard.called, 'never the unscoped emit').to.equal(false);
    const [call] = scoped(SocketEvents.BUG_REPORT_GENERATED);
    expect(call.args[1]).to.include({ sessionId: 's5', mode: 'full' });
    expect(call.args[2]).to.deep.equal({ udid: 'phone-b' });
  });

  it('a team change (PUT /device/:udid/team) refreshes the resolver at once', async () => {
    sinon.stub(prisma.team, 'findUnique').resolves({ id: 'team-c' } as any);
    const store = DeviceStoreFactory.getStore();
    sinon.stub(store, 'findDevices').resolves([{ udid: 'phone-a', host: 'h' }] as any);
    sinon.stub(store, 'findSavedPhones').resolves([]);
    const write = sinon.stub(store, 'updateDevice').resolves();
    const resolver = Container.get(DeviceTeamResolver);
    await resolver.resolve('phone-a'); // cached as team-a
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.auth = {
        kind: 'user-session',
        userId: 'admin',
        role: 'ADMIN',
        scopes: 'admin',
        teamIds: undefined,
      };
      next();
    });
    const router = express.Router();
    GridRouter.register(router, {} as any);
    app.use(router);
    const res = await request(app).put('/device/phone-a/team').send({ teamId: 'team-c' });
    expect(res.status).to.equal(200);
    expect(write.firstCall.args).to.deep.equal(['phone-a', 'h', { teamId: 'team-c' }]);
    expect(await resolver.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-c' });
    expect(lookups).to.deep.equal(['phone-a']);
  });
});
