import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../../src/services/SessionLifecycleService';
import { PluginContext } from '../../../src/PluginContext';
import { ApiKeyService } from '../../../src/services/ApiKeyService';
import { UserService } from '../../../src/services/UserService';
import { JwtKeyService } from '../../../src/services/token/JwtKeyService';
import {
  LeaseMemberRequired,
  LeaseService,
  LeaseSessionProof,
} from '../../../src/services/lease/LeaseService';
import { hashToken } from '../../../src/services/lease/leaseToken';
import { leaseMemberOf } from '../../../src/services/lease/leaseSessionCaps';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import * as pendingSessions from '../../../src/data-service/pending-sessions-service';
import * as deviceService from '../../../src/data-service/device-service';
import { DefaultPluginArgs } from '../../../src/interfaces/IPluginArgs';
import { config } from '../../../src/config';
import { DASHBORD_EVENT_MANAGER } from '../../../src/dashboard/event-manager';
import * as assets from '../../../src/dashboard/asset-manager';
import * as sessionService from '../../../src/dashboard/services/session-service';
import { SessionMetricsService } from '../../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../../src/services/logcat/SessionDeviceLogs';
import { SocketServer } from '../../../src/services/SocketServer';
import { TracingService } from '../../../src/services/TracingService';
import { MetricsService } from '../../../src/services/MetricsService';
import { prisma } from '../../../src/prisma';
import { saveRegistrations } from '../../helpers/container-registration';

// A group lease's members each carry xe:options.leaseMember, their index. A
// session on the group names its member and runs on that member's phone; a
// session on a single lease needs none. The Session row records the lease, so
// a group's sessions can be found together.

const TOKEN = 'f'.repeat(64);
const NAME_THE_MEMBER = 'name the lease member: xe:options.leaseMember';
const NOBODY: LeaseSessionProof = {
  canOverride: false,
  apiKeyId: null,
  userId: null,
  leaseToken: null,
};
const withToken: LeaseSessionProof = { ...NOBODY, leaseToken: TOKEN };

const memberRow = (index: number, udid: string, host: string) => ({
  index,
  udid,
  host,
  allocatedPorts: '{}',
  capabilityBag: JSON.stringify({
    'appium:udid': udid,
    'xe:options': { leaseId: 'lse_g', leaseMember: index },
  }),
});

const groupLease = () => ({
  id: 'lse_g',
  tokenHash: hashToken(TOKEN),
  deviceUdid: 'u1',
  deviceHost: 'h1',
  actorId: 'key_owner',
  teamId: null,
  status: 'active',
  expiresAt: Date.now() + 60_000,
  capabilityBag: memberRow(0, 'u1', 'h1').capabilityBag,
  members: [memberRow(0, 'u1', 'h1'), memberRow(1, 'u2', 'h2')],
});

const capsOf = (xenonOptions: Record<string, unknown>) => ({
  alwaysMatch: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'xe:options': { leaseId: 'lse_g', ...xenonOptions },
  },
  firstMatch: [{}],
});

describe('a session on a lease member', () => {
  describe('leaseMemberOf', () => {
    it('reads a non-negative whole number from xe:options.leaseMember', () => {
      expect(leaseMemberOf(capsOf({ leaseMember: 0 }) as any)).to.equal(0);
      expect(leaseMemberOf(capsOf({ leaseMember: 3 }) as any)).to.equal(3);
    });

    it('reads it from the xenon:options alias, xe:options winning', () => {
      const alias = { alwaysMatch: { 'xenon:options': { leaseMember: 2 } }, firstMatch: [{}] };
      expect(leaseMemberOf(alias)).to.equal(2);
      const both = {
        alwaysMatch: { 'xe:options': { leaseMember: 1 }, 'xenon:options': { leaseMember: 2 } },
        firstMatch: [{}],
      };
      expect(leaseMemberOf(both)).to.equal(1);
    });

    it('is undefined for anything else', () => {
      for (const value of ['1', -1, 1.5, NaN, Infinity, null, true, {}, []]) {
        expect(leaseMemberOf(capsOf({ leaseMember: value }) as any), String(value)).to.equal(
          undefined,
        );
      }
      expect(leaseMemberOf(capsOf({}) as any)).to.equal(undefined);
    });
  });

  describe('LeaseService.authorizeSessionUse', () => {
    let lease: any;
    let findUnique: sinon.SinonStub;
    let svc: LeaseService;

    beforeEach(() => {
      lease = groupLease();
      findUnique = sinon.stub().callsFake(async () => lease);
      const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
      svc = new LeaseService({ lease: { findUnique } }, {}, {}, noAuth);
    });

    afterEach(() => sinon.restore());

    it("resolves the named member's phone and capabilities", async () => {
      const got = await svc.authorizeSessionUse('lse_g', withToken, 1);
      expect(got).to.deep.equal({
        deviceUdid: 'u2',
        deviceHost: 'h2',
        capabilityBag: JSON.parse(memberRow(1, 'u2', 'h2').capabilityBag),
      });
      // It reads the lease with its members.
      expect(findUnique.firstCall.args[0]).to.deep.include({ include: { members: true } });
    });

    it('throws LeaseMemberRequired for a group named without a member', async () => {
      const err = await svc.authorizeSessionUse('lse_g', withToken).then(
        () => null,
        (e: Error) => e,
      );
      expect(err).to.be.instanceOf(LeaseMemberRequired);
      expect(err?.message).to.equal(NAME_THE_MEMBER);
    });

    it('checks the proof first: a caller without it gets null, not the member rule', async () => {
      expect(await svc.authorizeSessionUse('lse_g', NOBODY)).to.equal(null);
      expect(
        await svc.authorizeSessionUse('lse_g', { ...NOBODY, leaseToken: 'e'.repeat(64) }),
      ).to.equal(null);
    });

    it('answers null for a member the lease does not have', async () => {
      expect(await svc.authorizeSessionUse('lse_g', withToken, 2)).to.equal(null);
    });

    it('needs no member for a single lease, and refuses any but member 0', async () => {
      lease.members = [memberRow(0, 'u1', 'h1')];
      expect((await svc.authorizeSessionUse('lse_g', withToken))?.deviceUdid).to.equal('u1');
      expect((await svc.authorizeSessionUse('lse_g', withToken, 0))?.deviceUdid).to.equal('u1');
      expect(await svc.authorizeSessionUse('lse_g', withToken, 1)).to.equal(null);
    });

    it('reads a lease from before groups as member 0 of its own columns', async () => {
      lease.members = [];
      lease.capabilityBag = '{"appium:udid":"u1"}';
      expect(await svc.authorizeSessionUse('lse_g', withToken)).to.deep.equal({
        deviceUdid: 'u1',
        deviceHost: 'h1',
        capabilityBag: { 'appium:udid': 'u1' },
      });
    });
  });

  describe('createSession on a group lease', () => {
    let svc: SessionLifecycleService;
    let lease: any;
    let context: PluginContext;
    let savedContext: Partial<PluginContext>;
    let authDisabledBefore: boolean;
    let driverCaps: any;
    let pendingCopy: any;
    let finalCaps: any;
    let sessionDevice: any;
    let restore: () => void;

    const phones: Record<string, any> = {
      'u1@h1': { udid: 'u1', host: 'h1', platform: 'android', nodeId: 'node-hub', teamId: null },
      'u2@h2': { udid: 'u2', host: 'h2', platform: 'android', nodeId: 'node-hub', teamId: null },
    };

    const create = async (caps: any) => {
      const next = sinon.stub().callsFake(async () => {
        driverCaps = JSON.parse(JSON.stringify(caps));
        return { value: ['sess-1', { platformName: 'Android' }] };
      });
      await svc.createSession(next, {}, caps);
      return caps;
    };

    beforeEach(() => {
      authDisabledBefore = config.authDisabled;
      config.authDisabled = false;
      context = Container.get(PluginContext);
      savedContext = { pluginArgs: context.pluginArgs, nodeId: context.nodeId };
      context.pluginArgs = Object.assign({}, DefaultPluginArgs, { bindHostOrIp: '127.0.0.1' });
      context.nodeId = 'node-hub';

      lease = groupLease();
      const db = { lease: { findUnique: sinon.stub().callsFake(async () => lease) } };
      const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
      restore = saveRegistrations(LeaseService, ApiKeyService, UserService, JwtKeyService);
      Container.set(LeaseService, new LeaseService(db, {}, {}, noAuth));
      Container.set(ApiKeyService, { verifyPair: async () => null, hasScope: () => false } as any);
      Container.set(UserService, { findById: async () => null } as any);
      Container.set(JwtKeyService, { verify: async () => null } as any);
      sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);

      sinon.stub(DeviceStoreFactory, 'getStore').returns({
        findDevice: sinon.stub().callsFake(async (q: any) => phones[`${q.udid}@${q.host}`] ?? null),
        updateDevice: sinon.stub().resolves(),
      } as any);
      sinon.stub(pendingSessions, 'addNewPendingSession').callsFake(async (c: any) => {
        pendingCopy = JSON.parse(JSON.stringify(c));
      });
      sinon.stub(pendingSessions, 'removePendingSession').resolves();
      sinon.stub(deviceService, 'updateDeviceProgress').resolves();
      sinon.stub(deviceService, 'claimDeviceForSession').resolves(true);

      svc = new SessionLifecycleService();
      sinon.stub(svc as any, 'createSessionInstance').callsFake((...args: any[]) => {
        sessionDevice = args[1];
        finalCaps = JSON.parse(JSON.stringify(args[2]));
        return {};
      });
      sinon.stub(svc as any, 'applyPostSessionLogic').resolves();
      driverCaps = pendingCopy = finalCaps = sessionDevice = undefined;
    });

    afterEach(() => {
      config.authDisabled = authDisabledBefore;
      Object.assign(context, savedContext);
      sinon.restore();
      restore();
    });

    it("runs on the named member's phone", async () => {
      await create(capsOf({ leaseToken: TOKEN, leaseMember: 1 }));
      expect([sessionDevice.udid, sessionDevice.host]).to.deep.equal(['u2', 'h2']);
    });

    it('fails a create that names no member, with that message', async () => {
      const err = await create(capsOf({ leaseToken: TOKEN })).then(
        () => null,
        (e: Error) => e,
      );
      // Answered as session not created, as Appium words one.
      expect((err as any)?.error).to.equal('session not created');
      expect(err?.message).to.equal(
        `A new session could not be created. Details: ${NAME_THE_MEMBER}`,
      );
      expect(driverCaps).to.equal(undefined);
    });

    it('keeps leaseMember in the stored capabilities', async () => {
      await create(capsOf({ leaseToken: TOKEN, leaseMember: 1 }));
      // Not a secret: it reaches the pending row, the driver and the Session row's capabilities.
      expect(pendingCopy['xe:options'].leaseMember).to.equal(1);
      expect(driverCaps.alwaysMatch['xe:options'].leaseMember).to.equal(1);
      expect(finalCaps.desired['xe:options']).to.deep.equal({ leaseId: 'lse_g', leaseMember: 1 });
    });
  });

  describe('records the lease on the session row', () => {
    let restore: () => void;
    let create: sinon.SinonStub;

    const session = (desired: Record<string, unknown>) => ({
      getId: () => 'sess-lease',
      getCapabilities: () => ({ platformName: 'Android', desired }),
      getLiveVideoUrl: () => null,
      getType: () => 'remote',
      startPerformanceRecording: sinon.stub().resolves(),
      apiKeyId: null,
      userId: null,
    });
    const device = { udid: 'u2', host: 'h2', platform: 'android', nodeId: 'node-peer', name: 'S9' };
    const onLease = { platformName: 'Android', 'xe:options': { leaseId: 'lse_g', leaseMember: 1 } };
    const writtenLeaseId = () => create.lastCall.args[0].data.lease_id;

    beforeEach(() => {
      restore = saveRegistrations(SessionDeviceLogs, SessionMetricsService, SocketServer);
      // The dashboard's writer starts the session's device log: a stand-in, so
      // nothing reaches this machine's adb.
      Container.set(SessionDeviceLogs, {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        noteOff: sinon.stub().resolves(),
      } as any);
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
      sinon.stub(assets, 'prepareDirectory');
      sinon.stub(sessionService, 'getOrCreateNewBuild').resolves({ id: 'b-1' } as any);
      sinon.stub(TracingService.prototype, 'getTraceId').returns('t-1' as any);
      sinon.stub(MetricsService.prototype, 'incrementSessionStart');
      create = sinon.stub(prisma.session as any, 'create').resolves({} as any);
    });

    afterEach(() => {
      sinon.restore();
      restore();
      // onSessionStarted keeps the session's phone; nothing here ends the session.
      (DASHBORD_EVENT_MANAGER as any).sessionToDevice.delete('sess-lease');
    });

    it("in the dashboard's row (onSessionStarted)", async () => {
      await DASHBORD_EVENT_MANAGER.onSessionStarted({}, session(onLease) as any, device as any);
      expect(writtenLeaseId()).to.equal('lse_g');
      await DASHBORD_EVENT_MANAGER.onSessionStarted(
        {},
        session({ platformName: 'Android' }) as any,
        device as any,
      );
      expect(writtenLeaseId()).to.equal(null);
    });

    it("in a routed session's row (recordRoutedSession)", async () => {
      const lifecycle = new SessionLifecycleService();
      await (lifecycle as any).recordRoutedSession({}, session(onLease), device);
      expect(writtenLeaseId()).to.equal('lse_g');
      await (lifecycle as any).recordRoutedSession(
        {},
        session({ platformName: 'Android' }),
        device,
      );
      expect(writtenLeaseId()).to.equal(null);
    });
  });
});
