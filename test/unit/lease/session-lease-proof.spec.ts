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
import * as deviceUtils from '../../../src/device-utils';
import { DefaultPluginArgs } from '../../../src/interfaces/IPluginArgs';
import { config } from '../../../src/config';
import { redactSecrets } from '../../../src/logger';
import { RequestLogService } from '../../../src/services/RequestLogService';
import { EVENT_BUS } from '../../../src/services/EventBus';
import { JwtKeyService } from '../../../src/services/token/JwtKeyService';
import { HubSessionTokenIssuer } from '../../../src/gateway/hubSessionToken';
import { prisma } from '../../../src/prisma';
import { saveRegistrations } from '../../helpers/container-registration';

// createSession end to end, from the capabilities a client sends to the
// device it gets: the caller's identity has to reach the lease check, and the
// lease token has to stop there.

const TOKEN = 'f'.repeat(64);
const REFUSED =
  'lease lse_1 is not active, or this session did not prove it holds it — pass ' +
  'xe:options.leaseToken from the lease response, or create the session with the ' +
  'credentials that created the lease; and the phone must be one your teams can see';

const sessionCaps = (
  xenonOptions: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  alwaysMatch: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'xe:options': { leaseId: 'lse_1', ...xenonOptions },
    ...extra,
  },
  firstMatch: [{}],
});

// A key pair travels beside the lease id, in xe:options.
const key = (accessKey: string) => ({ accessKey, token: 'tk' });
const ownerKey = key('ak_owner');
const otherKey = key('ak_other');
// A session token names its user in `sub` and carries the scopes of the
// credential that minted it; the fake verifier echoes both back.
const sessionToken = (sub: string, scopes = 'sessions') => ({
  sessionToken: `jwt:${sub}|${scopes}`,
});

const keys: Record<string, any> = {
  ak_owner: { id: 'key_owner', userId: 'usr_owner', scopes: 'sessions', teamId: null },
  ak_other: { id: 'key_other', userId: 'usr_other', scopes: 'sessions', teamId: null },
  ak_team_a: { id: 'key_team_a', userId: 'usr_other', scopes: 'sessions', teamId: 'team_a' },
  // What profile.ts lets an ADMIN mint: never the admin scope.
  ak_admin_narrow: {
    id: 'key_admin_narrow',
    userId: 'usr_admin',
    scopes: 'devices,sessions,read',
    teamId: null,
  },
  ak_admin_scoped: { id: 'key_admin_scoped', userId: 'usr_admin', scopes: 'admin', teamId: null },
  ak_super: { id: 'key_super', userId: 'usr_super', scopes: 'sessions', teamId: null },
};

const roles: Record<string, string> = {
  usr_owner: 'MEMBER',
  usr_other: 'MEMBER',
  usr_admin: 'ADMIN',
  usr_super: 'SUPER_ADMIN',
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
  let restore: () => void;
  let teamRows: sinon.SinonStub;

  // Stands in for the driver: `next` is how Appium hands these same caps on.
  const create = async (caps: any) => {
    const next = sinon.stub().callsFake(async () => {
      driverCaps = JSON.parse(JSON.stringify(caps));
      return { value: ['sess-1', { platformName: 'Android' }] };
    });
    await svc.createSession(next, {}, caps);
    return caps;
  };

  const allowed = async (caps: any) => {
    await create(caps);
    return driverCaps !== undefined;
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
    restore = saveRegistrations(LeaseService, ApiKeyService, UserService, JwtKeyService);
    Container.set(LeaseService, new LeaseService(db, {}, {}, noAuth));
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().callsFake(async (ak: string) => keys[ak] ?? null),
      hasScope: (row: any, req: string[]) => {
        const owned = row.scopes.split(',');
        return owned.includes('admin') || req.some((s) => owned.includes(s));
      },
    } as any);
    Container.set(UserService, {
      findById: async (id: string) =>
        roles[id] ? { id, role: roles[id], status: 'ACTIVE' } : null,
    } as any);
    Container.set(JwtKeyService, {
      verify: async (t: string) => {
        const [sub, scopes] = t.replace(/^jwt:/, '').split('|');
        return { sub, teamId: null, scopes };
      },
    } as any);
    teamRows = sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);

    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: sinon.stub().callsFake(async () => device),
      // The lease branch records the session's newCommandTimeout on the row.
      updateDevice: sinon.stub().resolves(),
    } as any);
    sinon.stub(pendingSessions, 'addNewPendingSession').callsFake(async (c: any) => {
      pendingCopy = JSON.parse(JSON.stringify(c));
    });
    sinon.stub(pendingSessions, 'removePendingSession').resolves();
    sinon.stub(deviceService, 'updateDeviceProgress').resolves();
    sinon.stub(deviceService, 'claimDeviceForSession').resolves(true);

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
    restore();
  });

  describe('who gets the device', () => {
    it('the key that created the lease, with no token', async () => {
      await create(sessionCaps(ownerKey));
      expect(driverCaps).to.not.equal(undefined);
    });

    it('any caller presenting the lease token', async () => {
      await create(sessionCaps({ leaseToken: TOKEN }));
      expect(driverCaps).to.not.equal(undefined);
    });

    it('a session naming the lease in the xenon:options alias, as before', async () => {
      const caps: any = sessionCaps({});
      delete caps.alwaysMatch['xe:options'];
      caps.alwaysMatch['xenon:options'] = { leaseId: 'lse_1', leaseToken: TOKEN };
      await create(caps);
      expect(driverCaps.alwaysMatch['xenon:options']).to.deep.equal({ leaseId: 'lse_1' });
    });

    it('with auth disabled, a session that sends only the lease id, as before', async () => {
      config.authDisabled = true;
      await create(sessionCaps({}));
      expect(driverCaps).to.not.equal(undefined);
    });

    it('the user who created the lease, through a session token', async () => {
      lease.actorId = 'usr_owner'; // a bearer- or cookie-created lease records the user
      expect(await allowed(sessionCaps(sessionToken('usr_owner')))).to.equal(true);
    });

    it('any key of the user who created the lease', async () => {
      lease.actorId = 'usr_other';
      expect(await allowed(sessionCaps(key('ak_team_a')))).to.equal(true);
    });
  });

  it('leaves no pending-session row when looking up lease access throws', async () => {
    // Every row added must be removed again on a failed create.
    const rows = new Set<string>();
    (pendingSessions.addNewPendingSession as sinon.SinonStub).callsFake(async (c: any) => {
      rows.add(c.capability_id);
    });
    (pendingSessions.removePendingSession as sinon.SinonStub).callsFake(async (id: string) => {
      rows.delete(id);
    });
    sinon.stub(svc as any, 'lookUpLeaseAccess').rejects(new Error('lookup blew up'));
    expect(await refusal(sessionCaps(ownerKey))).to.equal('lookup blew up');
    expect([...rows]).to.deep.equal([]);
  });

  // Every credentialed session is scoped by its owner's teams, as REST is, so
  // the owner is looked up whether or not a lease is named: once, and shared
  // with the lease check when there is one.
  it('a session that names no lease reads its user and teams once, to scope it', async () => {
    const findById = sinon.spy(Container.get(UserService), 'findById');
    sinon.stub(deviceUtils, 'allocateDeviceForSession').resolves(device);
    const caps: any = sessionCaps(ownerKey);
    delete caps.alwaysMatch['xe:options'].leaseId;
    await create(caps);
    expect(findById.calledOnce).to.equal(true);
    expect(teamRows.calledOnce).to.equal(true);
  });

  describe('the platform allocation lock', () => {
    // Ordinary creates queue on it, first come first served, each with its
    // full wait from the head of the queue. A lease-bound create allocates
    // nothing and used to queue behind them anyway, for up to their wait.
    const plainCaps = () => {
      const caps: any = sessionCaps(ownerKey);
      delete caps.alwaysMatch['xe:options'].leaseId;
      return caps;
    };
    const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it("doesn't make a lease-bound create queue behind one waiting for a phone", async () => {
      const real = deviceUtils.allocateDeviceForSession;
      let releaseWaiter: (d: any) => void = () => undefined;
      sinon.stub(deviceUtils, 'allocateDeviceForSession').callsFake(((c: any, ...rest: any[]) =>
        c.alwaysMatch['xe:options']?.leaseId
          ? (real as any)(c, ...rest)
          : new Promise((resolve) => {
              releaseWaiter = resolve;
            })) as any);

      const waiting = create(plainCaps());
      let leased: Promise<unknown> = Promise.resolve();
      try {
        await tick(50);
        let leasedDone = false;
        leased = create(sessionCaps(ownerKey)).then(() => {
          leasedDone = true;
        });
        await Promise.race([leased, tick(2_000)]);
        expect(leasedDone, 'the lease-bound create waited on the lock').to.equal(true);
      } finally {
        // Free the platform lock even when this fails, and let both creates
        // finish here, or they run on into the next test.
        releaseWaiter(device);
        await waiting;
        await leased;
      }
    });

    it('still queues ordinary creates one at a time', async () => {
      const waiters: Array<(d: any) => void> = [];
      const allocate = sinon
        .stub(deviceUtils, 'allocateDeviceForSession')
        .callsFake((() => new Promise((resolve) => waiters.push(resolve))) as any);

      const first = create(plainCaps());
      const second = create(plainCaps());
      await tick(100);
      expect(allocate.callCount, 'the second create allocated before the first finished').to.equal(
        1,
      );

      waiters[0](device);
      await first;
      await tick(50);
      expect(allocate.callCount).to.equal(2);
      waiters[1](device);
      await second;
    });
  });

  it('a session that names a lease reads them once too, for the scope and the lease', async () => {
    const findById = sinon.spy(Container.get(UserService), 'findById');
    await allowed(sessionCaps(ownerKey));
    expect(findById.calledOnce).to.equal(true);
  });

  describe('taking over a lease someone else created', () => {
    it("is refused to an ADMIN's key without the admin scope", async () => {
      expect(await refusal(sessionCaps(key('ak_admin_narrow')))).to.equal(REFUSED);
    });

    it("is allowed to that ADMIN's key with the admin scope", async () => {
      expect(await allowed(sessionCaps(key('ak_admin_scoped')))).to.equal(true);
    });

    it("is allowed to a SUPER_ADMIN's key", async () => {
      expect(await allowed(sessionCaps(key('ak_super')))).to.equal(true);
    });

    // A session token minted from the dashboard carries the admin's admin
    // scope; one minted with an ADMIN's narrower key doesn't, and overrides
    // no more than that key does.
    it('is allowed to an ADMIN presenting a session token, as on the dashboard', async () => {
      expect(await allowed(sessionCaps(sessionToken('usr_admin', 'admin,sessions')))).to.equal(
        true,
      );
    });

    it("is refused to an ADMIN's session token minted without the admin scope", async () => {
      expect(await refusal(sessionCaps(sessionToken('usr_admin', 'sessions')))).to.equal(REFUSED);
    });

    it('is refused to a member presenting a session token', async () => {
      expect(await refusal(sessionCaps(sessionToken('usr_other')))).to.equal(REFUSED);
    });
  });

  describe("the leased phone must be one the caller's teams can see, as on REST", () => {
    beforeEach(() => {
      device.teamId = 'team_b';
    });

    it("allows the owner when they are in the phone's team", async () => {
      teamRows.resolves([{ teamId: 'team_b' }] as any);
      expect(await allowed(sessionCaps(ownerKey))).to.equal(true);
    });

    it('refuses the owner once they are not', async () => {
      teamRows.resolves([{ teamId: 'team_a' }] as any);
      expect(await refusal(sessionCaps(ownerKey))).to.equal(REFUSED);
    });

    it("allows an ADMIN's own lease on any team's phone, since REST let them take it", async () => {
      lease.actorId = 'key_admin_narrow';
      expect(await allowed(sessionCaps(key('ak_admin_narrow')))).to.equal(true);
    });
  });

  describe('who is refused', () => {
    it('a caller with no credentials and no token', async () => {
      expect(await refusal(sessionCaps({}))).to.equal(REFUSED);
    });

    it('a caller with a wrong token', async () => {
      expect(await refusal(sessionCaps({ leaseToken: 'e'.repeat(64) }))).to.equal(REFUSED);
    });

    it('a different API key', async () => {
      expect(await refusal(sessionCaps(otherKey))).to.equal(REFUSED);
    });

    it('a team-bound key with the right token, when the device is in another team', async () => {
      device.teamId = 'team_b';
      const caps = sessionCaps({ leaseToken: TOKEN, ...key('ak_team_a') });
      expect(await refusal(caps)).to.equal(REFUSED);
    });
  });

  describe('the lease token stops at the lease check', () => {
    it('never reaches the pending-session row, the driver or the Session row', async () => {
      const caps = await create(sessionCaps({ leaseToken: TOKEN }));

      for (const seen of [pendingCopy, driverCaps, finalCaps, caps]) {
        expect(JSON.stringify(seen)).to.not.include(TOKEN);
      }
      // The lease id is not a secret and still travels.
      expect(driverCaps.alwaysMatch['xe:options'].leaseId).to.equal('lse_1');
      expect(finalCaps.desired['xe:options'].leaseId).to.equal('lse_1');
    });

    it('is taken from every capability bucket, not only the one it is read from', async () => {
      const caps: any = sessionCaps({ leaseToken: TOKEN });
      caps.firstMatch = [{ 'xe:options': { leaseToken: TOKEN } }];
      await create(caps);
      expect(JSON.stringify(driverCaps)).to.not.include(TOKEN);
    });

    it('counts only beside the lease id: in firstMatch while leaseId is in alwaysMatch, it is stripped but not honoured', async () => {
      const caps: any = sessionCaps({});
      caps.firstMatch = [{ 'xe:options': { leaseToken: TOKEN } }];
      expect(await refusal(caps)).to.equal(REFUSED);
      expect(JSON.stringify(caps)).to.not.include(TOKEN);
      expect(JSON.stringify(pendingCopy)).to.not.include(TOKEN);
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
        // The hub's token needs its signing key, which this spec has no use for.
        sinon.stub(HubSessionTokenIssuer.prototype, 'createTokenFor').resolves('HUB-TOKEN');
      });

      it('forwards neither the lease id nor its token to a peer Xenon node: the hub resolved the lease to its phone', async () => {
        device.nodeId = 'node-peer';
        await create(sessionCaps({ leaseToken: TOKEN }));
        expect(JSON.stringify(forwardedCaps)).to.not.include(TOKEN);
        expect(JSON.stringify(forwardedCaps)).to.not.include('lse_1');
        expect(forwardedCaps.alwaysMatch['appium:udid']).to.equal('u1');
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
    const out: any = redactSecrets({ 'xe:options': { leaseId: 'lse_1', leaseToken: TOKEN } });
    expect(out['xe:options'].leaseId).to.equal('lse_1');
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
