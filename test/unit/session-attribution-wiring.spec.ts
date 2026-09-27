import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { UserService } from '../../src/services/UserService';
import { config } from '../../src/config';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';

// authorizeSessionRequest is private; these drive it directly because it is
// the single place a session's identity is decided, and getting it wrong
// silently denies the caller their own device later.
const invoke = (svc: any, caps: any) => svc.authorizeSessionRequest(caps);

const capsWith = (obj: Record<string, unknown>) => ({
  alwaysMatch: obj,
  firstMatch: [{}],
});

describe('authorizeSessionRequest — identity', () => {
  let svc: any;
  let authDisabledBefore: boolean;

  beforeEach(() => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;
    svc = Container.get(SessionLifecycleService);
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    sinon.restore();
    Container.reset();
  });

  it('returns both ids for a valid df:options pair', async () => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves({
        id: 'key_abc',
        userId: 'usr_alice',
        scopes: 'sessions',
        teamId: null,
      }),
      hasScope: (row: any, req: string[]) => req.every((r) => row.scopes.includes(r)),
    } as any);

    const res = await invoke(svc, capsWith({ 'df:options': { accessKey: 'ak', token: 'tk' } }));

    expect(res.apiKeyId).to.equal('key_abc');
    expect(res.userId).to.equal('usr_alice');
  });

  it('attributes a session-token caller even with the gate off', async () => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      hasScope: () => false,
    } as any);
    Container.set(JwtKeyService, {
      verify: sinon.stub().resolves({ sub: 'usr_carol' }),
    } as any);

    const res = await invoke(svc, capsWith({ 'xenon:options': { sessionToken: 'tok' } }));

    expect(res.apiKeyId).to.equal(null);
    expect(res.userId).to.equal('usr_carol');
  });

  it('leaves a credential-less session unattributed', async () => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      hasScope: () => false,
    } as any);

    const res = await invoke(svc, capsWith({}));

    expect(res.apiKeyId).to.equal(null);
    expect(res.userId).to.equal(null);
  });

  it('short-circuits to unattributed when auth is disabled', async () => {
    config.authDisabled = true;

    const res = await invoke(svc, capsWith({ 'df:options': { accessKey: 'ak', token: 'tk' } }));

    expect(res.apiKeyId).to.equal(null);
    expect(res.userId).to.equal(null);
  });
});

// leaseAccess() decides how a session that names a lease is judged: whether
// it may use one it did not create (an ownership override, following
// resolveActor), and which teams bound the leased phone (REST's
// computeTeamIds). It is looked up only when asked, so a session that names
// no lease pays for no extra reads.
describe('authorizeSessionRequest — leaseAccess', () => {
  let svc: any;
  let authDisabledBefore: boolean;
  let restore: () => void;
  let findUser: sinon.SinonStub;
  let teamRows: sinon.SinonStub;

  const keyRow = (scopes: string, teamId: string | null = null) => ({
    id: 'key_abc',
    userId: 'usr_alice',
    scopes,
    teamId,
  });
  const user = (role: string, status = 'ACTIVE') => ({ id: 'usr_alice', role, status });

  const withKey = (row: any, owner: any) => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(row),
      hasScope: (r: any, req: string[]) => {
        const owned = r.scopes.split(',');
        return owned.includes('admin') || req.some((s) => owned.includes(s));
      },
    } as any);
    findUser = sinon.stub().resolves(owner);
    Container.set(UserService, { findById: findUser } as any);
  };

  const withSessionToken = (owner: any, teamId: string | null = null) => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      hasScope: () => false,
    } as any);
    Container.set(JwtKeyService, {
      verify: sinon.stub().resolves({ sub: 'usr_alice', teamId }),
    } as any);
    findUser = sinon.stub().resolves(owner);
    Container.set(UserService, { findById: findUser } as any);
  };

  const pairCaps = capsWith({ 'df:options': { accessKey: 'ak', token: 'tk' } });
  const tokenCaps = capsWith({ 'xenon:options': { sessionToken: 'tok' } });
  const access = async (caps: any) => (await invoke(svc, caps)).leaseAccess();

  beforeEach(() => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;
    restore = saveRegistrations(ApiKeyService, JwtKeyService, UserService);
    teamRows = sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
    svc = new SessionLifecycleService();
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    sinon.restore();
    restore();
  });

  it('reads nothing until a lease asks', async () => {
    withKey(keyRow('sessions'), user('MEMBER'));
    const res = await invoke(svc, pairCaps);
    expect(findUser.called).to.equal(false);
    expect(teamRows.called).to.equal(false);
    await res.leaseAccess();
    expect(findUser.calledOnceWith('usr_alice')).to.equal(true);
  });

  describe('canOverride', () => {
    it("is false for an ADMIN's key without the admin scope", async () => {
      withKey(keyRow('devices,sessions,read'), user('ADMIN'));
      expect((await access(pairCaps)).canOverride).to.equal(false);
    });

    it("is true for the same ADMIN's key with the admin scope, and for a SUPER_ADMIN's key", async () => {
      withKey(keyRow('admin,sessions'), user('ADMIN'));
      expect((await access(pairCaps)).canOverride).to.equal(true);
      withKey(keyRow('sessions'), user('SUPER_ADMIN'));
      expect((await access(pairCaps)).canOverride).to.equal(true);
    });

    it("is false for a member's key, and for an admin whose account is not active", async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      expect((await access(pairCaps)).canOverride).to.equal(false);
      withKey(keyRow('admin'), user('SUPER_ADMIN', 'INACTIVE'));
      expect((await access(pairCaps)).canOverride).to.equal(false);
    });

    it('follows the role of a session-token caller, ADMIN included', async () => {
      withSessionToken(user('ADMIN'));
      expect((await access(tokenCaps)).canOverride).to.equal(true);
      withSessionToken(user('MEMBER'));
      expect((await access(tokenCaps)).canOverride).to.equal(false);
    });

    it('is false for a credential-less session, even though it is unscoped', async () => {
      Container.set(ApiKeyService, {
        verifyPair: sinon.stub().resolves(null),
        hasScope: () => false,
      } as any);
      const res = await invoke(svc, capsWith({}));
      expect(res.scoped).to.equal(false);
      expect((await res.leaseAccess()).canOverride).to.equal(false);
    });

    it('is false when the lookup fails, and the teams fall back to the shared pool', async () => {
      withKey(keyRow('admin'), null);
      Container.set(UserService, { findById: sinon.stub().rejects(new Error('db down')) } as any);
      expect(await access(pairCaps)).to.deep.equal({ canOverride: false, teamIds: [] });
    });

    it('is true when auth is disabled, where every caller is an admin', async () => {
      config.authDisabled = true;
      expect(await access(capsWith({}))).to.deep.equal({ canOverride: true, teamIds: undefined });
    });
  });

  describe('teamIds, as REST computes them', () => {
    it('is unscoped for an ADMIN or SUPER_ADMIN owner, whatever the key', async () => {
      withKey(keyRow('sessions', 'team_a'), user('ADMIN'));
      expect((await access(pairCaps)).teamIds).to.equal(undefined);
    });

    it("is the key's team when the key is narrowed", async () => {
      withKey(keyRow('sessions', 'team_a'), user('MEMBER'));
      expect((await access(pairCaps)).teamIds).to.deep.equal(['team_a']);
    });

    it("is the member's teams otherwise", async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      teamRows.resolves([{ teamId: 'team_a' }, { teamId: 'team_b' }] as any);
      expect((await access(pairCaps)).teamIds).to.deep.equal(['team_a', 'team_b']);
    });

    it("is a session token's team claim when it has one", async () => {
      withSessionToken(user('MEMBER'), 'team_b');
      expect((await access(tokenCaps)).teamIds).to.deep.equal(['team_b']);
    });
  });
});
