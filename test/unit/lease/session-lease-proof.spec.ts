import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../../src/services/SessionLifecycleService';
import { PluginContext } from '../../../src/PluginContext';
import { ApiKeyService } from '../../../src/services/ApiKeyService';
import { UserService } from '../../../src/services/UserService';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { hashToken } from '../../../src/services/lease/leaseToken';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import * as pendingSessions from '../../../src/data-service/pending-sessions-service';
import * as deviceService from '../../../src/data-service/device-service';
import { DefaultPluginArgs } from '../../../src/interfaces/IPluginArgs';
import { config } from '../../../src/config';
import { redactSecrets } from '../../../src/logger';
import { RequestLogService } from '../../../src/services/RequestLogService';
import { EVENT_BUS } from '../../../src/services/EventBus';
import { overrideService, restoreServices } from '../../helpers/service-override';

// createSession end to end, from the capabilities a client sends to the
// device it gets: the caller's identity has to reach the lease check, and the
// lease token has to stop there.

const TOKEN = 'f'.repeat(64);
const NOT_ACTIVE = 'lease lse_1 is not active';

const sessionCaps = (
  xenonOptions: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  alwaysMatch: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'xenon:options': { leaseId: 'lse_1', ...xenonOptions },
    ...extra,
  },
  firstMatch: [{}],
});

const ownerKey = { 'df:options': { accessKey: 'ak_owner', token: 'tk_owner' } };
const otherKey = { 'df:options': { accessKey: 'ak_other', token: 'tk_other' } };

const keys: Record<string, any> = {
  ak_owner: { id: 'key_owner', userId: 'usr_owner', scopes: 'sessions', teamId: null },
  ak_other: { id: 'key_other', userId: 'usr_other', scopes: 'sessions', teamId: null },
  ak_team_a: { id: 'key_team_a', userId: 'usr_other', scopes: 'sessions', teamId: 'team_a' },
};

describe('createSession — a lease-bound session proves it holds the lease', () => {
  let svc: SessionLifecycleService;
  let device: any;
  let lease: any;
  let context: PluginContext;
  let savedContext: Partial<PluginContext>;
  let authDisabledBefore: boolean;
  let driverCaps: any;
  let pendingCopy: any;
  let finalCaps: any;
  let forwardedCaps: any;

  // Stands in for the driver: `next` is how Appium hands these same caps on.
  const create = async (caps: any) => {
    const next = sinon.stub().callsFake(async () => {
      driverCaps = JSON.parse(JSON.stringify(caps));
      return { value: ['sess-1', { platformName: 'Android' }] };
    });
    await svc.createSession(next, {}, caps);
    return caps;
  };

  const refusal = async (caps: any) => {
    try {
      await create(caps);
    } catch (err: any) {
      return err.message as string;
    }
    return 'allocated';
  };

  beforeEach(() => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;

    context = Container.get(PluginContext);
    savedContext = { pluginArgs: context.pluginArgs, nodeId: context.nodeId };
    context.pluginArgs = Object.assign({}, DefaultPluginArgs, { bindHostOrIp: '127.0.0.1' });
    context.nodeId = 'node-hub';

    device = { udid: 'u1', host: 'h1', platform: 'android', nodeId: 'node-hub', teamId: null };
    lease = {
      id: 'lse_1',
      tokenHash: hashToken(TOKEN),
      deviceUdid: 'u1',
      deviceHost: 'h1',
      actorId: 'key_owner',
      teamId: null,
      status: 'active',
      expiresAt: Date.now() + 60_000,
      capabilityBag: '{}',
    };

    const db = { lease: { findUnique: sinon.stub().callsFake(async () => lease) } };
    const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
    overrideService(LeaseService, new LeaseService(db, {}, {}, noAuth));
    overrideService(ApiKeyService, {
      verifyPair: sinon.stub().callsFake(async (ak: string) => keys[ak] ?? null),
      hasScope: (row: any, req: string[]) => {
        const owned = row.scopes.split(',');
        return owned.includes('admin') || req.some((s) => owned.includes(s));
      },
    });
    overrideService(UserService, {
      findById: sinon
        .stub()
        .callsFake(async (id: string) => ({ id, role: 'MEMBER', status: 'ACTIVE' })),
    });

    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: sinon.stub().callsFake(async () => device),
    } as any);
    sinon.stub(pendingSessions, 'addNewPendingSession').callsFake(async (c: any) => {
      pendingCopy = JSON.parse(JSON.stringify(c));
    });
    sinon.stub(pendingSessions, 'removePendingSession').resolves();
    sinon.stub(deviceService, 'updateDeviceProgress').resolves();
    sinon.stub(deviceService, 'updatedAllocatedDevice').resolves();

    svc = new SessionLifecycleService();
    // Everything past finalizeSession's own bookkeeping is out of scope here;
    // what matters is the session response that becomes the Session row.
    sinon.stub(svc as any, 'createSessionInstance').callsFake((...args: any[]) => {
      finalCaps = JSON.parse(JSON.stringify(args[2]));
      return {};
    });
    sinon.stub(svc as any, 'applyPostSessionLogic').resolves();
    driverCaps = pendingCopy = finalCaps = forwardedCaps = undefined;
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    Object.assign(context, savedContext);
    sinon.restore();
    restoreServices();
  });

  describe('who gets the device', () => {
    it('the key that created the lease, with no token', async () => {
      await create(sessionCaps({}, ownerKey));
      expect(driverCaps).to.not.equal(undefined);
    });

    it('any caller presenting the lease token', async () => {
      await create(sessionCaps({ leaseToken: TOKEN }));
      expect(driverCaps).to.not.equal(undefined);
    });

    it('with auth disabled, a session that sends only the lease id, as before', async () => {
      config.authDisabled = true;
      await create(sessionCaps({}));
      expect(driverCaps).to.not.equal(undefined);
    });
  });

  describe('who is refused', () => {
    it('a caller with no credentials and no token', async () => {
      expect(await refusal(sessionCaps({}))).to.equal(NOT_ACTIVE);
    });

    it('a caller with a wrong token', async () => {
      expect(await refusal(sessionCaps({ leaseToken: 'e'.repeat(64) }))).to.equal(NOT_ACTIVE);
    });

    it('a different API key', async () => {
      expect(await refusal(sessionCaps({}, otherKey))).to.equal(NOT_ACTIVE);
    });

    it('a team-bound key with the right token, when the device is in another team', async () => {
      device.teamId = 'team_b';
      const caps = sessionCaps(
        { leaseToken: TOKEN },
        { 'df:options': { accessKey: 'ak_team_a', token: 'tk' } },
      );
      expect(await refusal(caps)).to.equal(NOT_ACTIVE);
    });
  });

  describe('the lease token stops at the lease check', () => {
    it('never reaches the pending-session row, the driver or the Session row', async () => {
      const caps = await create(sessionCaps({ leaseToken: TOKEN }));

      for (const seen of [pendingCopy, driverCaps, finalCaps, caps]) {
        expect(JSON.stringify(seen)).to.not.include(TOKEN);
      }
      // The lease id is not a secret and still travels.
      expect(driverCaps.alwaysMatch['xenon:options'].leaseId).to.equal('lse_1');
      expect(finalCaps.desired['xenon:options'].leaseId).to.equal('lse_1');
    });

    it('is taken from every capability bucket, not only the one it is read from', async () => {
      const caps: any = sessionCaps({ leaseToken: TOKEN });
      caps.firstMatch = [{ 'xenon:options': { leaseToken: TOKEN } }];
      await create(caps);
      expect(JSON.stringify(driverCaps)).to.not.include(TOKEN);
    });

    describe('when the device is on another node', () => {
      beforeEach(() => {
        sinon.stub(svc as any, 'finalizeSession').callsFake(async (...args: any[]) => {
          finalCaps = JSON.parse(JSON.stringify(args[2]));
        });
        sinon.stub(svc, 'forwardSessionRequest').callsFake(async (_d: any, c: any) => {
          forwardedCaps = JSON.parse(JSON.stringify(c));
          return { protocol: 'W3C', value: ['sess-1', {}, 'W3C'] } as any;
        });
      });

      it('forwards the token to a peer Xenon node, which runs the same check', async () => {
        device.nodeId = 'node-peer';
        await create(sessionCaps({ leaseToken: TOKEN }));
        expect(forwardedCaps.alwaysMatch['xenon:options'].leaseToken).to.equal(TOKEN);
        expect(JSON.stringify(finalCaps)).to.not.include(TOKEN);
        expect(JSON.stringify(pendingCopy)).to.not.include(TOKEN);
      });

      it('never forwards the token to a cloud provider', async () => {
        device.nodeId = undefined;
        device.cloud = true;
        await create(sessionCaps({ leaseToken: TOKEN }));
        expect(JSON.stringify(forwardedCaps)).to.not.include(TOKEN);
      });
    });
  });
});

describe('the lease token is redacted wherever it can still be logged', () => {
  afterEach(() => sinon.restore());

  it('by the structured logger', () => {
    const out: any = redactSecrets({ 'xenon:options': { leaseId: 'lse_1', leaseToken: TOKEN } });
    expect(out['xenon:options'].leaseId).to.equal('lse_1');
    expect(JSON.stringify(out)).to.not.include(TOKEN);
  });

  it('by the outgoing-request log that records a forward to a peer node', async () => {
    // Keep this instance off the process-wide event bus.
    sinon.stub(EVENT_BUS, 'on');
    const requests = new RequestLogService();
    await new Promise((resolve) => setImmediate(resolve)); // its subscription is async
    await requests.logRequest({
      direction: 'outgoing',
      method: 'POST',
      url: 'http://node:4723/session',
      requestBody: JSON.stringify({ capabilities: sessionCaps({ leaseToken: TOKEN }) }),
      statusCode: 200,
    });
    expect(requests.getRecentLogs(1)[0].requestBody).to.not.include(TOKEN);
  });
});
