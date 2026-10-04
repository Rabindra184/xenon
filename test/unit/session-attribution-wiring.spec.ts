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
import { takeSessionCredentials } from '../../src/services/session/sessionCredentials';

// authorizeSessionRequest is private; these drive it directly because it is
// the single place a session's identity is decided, and getting it wrong
// silently denies the caller their own device later. It is handed the
// credentials createSession took out of the caps, as createSession does.
const invoke = (svc: any, caps: any) =>
  svc.authorizeSessionRequest(caps, takeSessionCredentials(caps));

const capsWith = (obj: Record<string, unknown>) => ({
  alwaysMatch: obj,
  firstMatch: [{}],
});

describe('authorizeSessionRequest — identity', () => {
  let svc: any;
  let authDisabledBefore: boolean;
  let restore: () => void;

  beforeEach(() => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;
    restore = saveRegistrations(ApiKeyService, JwtKeyService, UserService);
    // Every id is an ACTIVE member in no team: a credential names its owner
    // only while they are (session-create-credential-owner.spec.ts covers
    // the other cases). The real lookups would read the developer's database.
    Container.set(UserService, {
      findById: async (id: string) => ({ id, role: 'MEMBER', status: 'ACTIVE' }),
    } as any);
    sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
    svc = new SessionLifecycleService();
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    sinon.restore();
    restore();
  });

  it('returns both ids for a valid xe:options pair', async () => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves({
        id: 'key_abc',
        userId: 'usr_alice',
        scopes: 'sessions',
        teamId: null,
      }),
      hasScope: (row: any, req: string[]) => req.every((r) => row.scopes.includes(r)),
    } as any);

    const res = await invoke(svc, capsWith({ 'xe:options': { accessKey: 'ak', token: 'tk' } }));

    expect(res.apiKeyId).to.equal('key_abc');
    expect(res.userId).to.equal('usr_alice');
  });

  it('still reads the pair from the xenon:options alias', async () => {
    const verifyPair = sinon.stub().resolves({
      id: 'key_abc',
      userId: 'usr_alice',
      scopes: 'sessions',
      teamId: null,
    });
    Container.set(ApiKeyService, {
      verifyPair,
      hasScope: (row: any, req: string[]) => req.every((r) => row.scopes.includes(r)),
    } as any);

    const res = await invoke(
      svc,
      capsWith({
        'xenon:options': { accessKey: 'ak', token: 'tk_old' },
        'xe:options': { token: 'tk' },
      }),
    );

    // xe:options wins field by field: its token, the alias's access key.
    expect(verifyPair.calledOnceWith('ak', 'tk')).to.equal(true);
    expect(res.userId).to.equal('usr_alice');
  });

  it('leaves a session sending only df:options unattributed, and never verifies it', async () => {
    const verifyPair = sinon.stub().resolves({
      id: 'key_abc',
      userId: 'usr_alice',
      scopes: 'sessions',
      teamId: null,
    });
    Container.set(ApiKeyService, { verifyPair, hasScope: () => true } as any);

    const res = await invoke(svc, capsWith({ 'df:options': { accessKey: 'ak', token: 'tk' } }));

    expect(verifyPair.called).to.equal(false);
    expect(res.apiKeyId).to.equal(null);
    expect(res.userId).to.equal(null);
  });

  it('attributes a session-token caller even with the gate off', async () => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      hasScope: () => false,
    } as any);
    Container.set(JwtKeyService, {
      verify: sinon.stub().resolves({ sub: 'usr_carol', scopes: 'sessions' }),
    } as any);

    const res = await invoke(svc, capsWith({ 'xe:options': { sessionToken: 'tok' } }));

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

    const res = await invoke(svc, capsWith({ 'xe:options': { accessKey: 'ak', token: 'tk' } }));

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

  // A session token carries the scopes of the credential that minted it.
  const withSessionToken = (owner: any, teamId: string | null = null, scopes = 'sessions') => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      hasScope: () => false,
    } as any);
    Container.set(JwtKeyService, {
      verify: sinon.stub().resolves({ sub: 'usr_alice', teamId, scopes }),
    } as any);
    findUser = sinon.stub().resolves(owner);
    Container.set(UserService, { findById: findUser } as any);
  };

  // Fresh each time: taking the credentials strips them from the caps.
  const pairCaps = () => capsWith({ 'xe:options': { accessKey: 'ak', token: 'tk' } });
  const tokenCaps = () => capsWith({ 'xe:options': { sessionToken: 'tok' } });
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

  it('looks the owner up once per session, however often a lease asks', async () => {
    withKey(keyRow('sessions'), user('MEMBER'));
    const res = await invoke(svc, pairCaps());
    await res.leaseAccess();
    await res.leaseAccess();
    expect(findUser.calledOnceWith('usr_alice')).to.equal(true);
    expect(teamRows.calledOnce).to.equal(true);
  });

  describe('canOverride', () => {
    it("is false for an ADMIN's key without the admin scope", async () => {
      withKey(keyRow('devices,sessions,read'), user('ADMIN'));
      expect((await access(pairCaps())).canOverride).to.equal(false);
    });

    it("is true for the same ADMIN's key with the admin scope, and for a SUPER_ADMIN's key", async () => {
      withKey(keyRow('admin,sessions'), user('ADMIN'));
      expect((await access(pairCaps())).canOverride).to.equal(true);
      withKey(keyRow('sessions'), user('SUPER_ADMIN'));
      expect((await access(pairCaps())).canOverride).to.equal(true);
    });

    it("is false for a member's key, and for an admin whose account is not active", async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      expect((await access(pairCaps())).canOverride).to.equal(false);
      withKey(keyRow('admin'), user('SUPER_ADMIN', 'INACTIVE'));
      expect((await access(pairCaps())).canOverride).to.equal(false);
    });

    // By the scopes it was minted with, as a key is judged. By its user's role
    // alone, an ADMIN's key without the admin scope minted itself an override.
    it("needs a session token's admin scope and its user's admin role now", async () => {
      withSessionToken(user('ADMIN'), null, 'admin,sessions');
      expect((await access(tokenCaps())).canOverride).to.equal(true);
      withSessionToken(user('ADMIN'), null, 'sessions');
      expect((await access(tokenCaps())).canOverride).to.equal(false);
      withSessionToken(user('SUPER_ADMIN'), null, 'admin,sessions');
      expect((await access(tokenCaps())).canOverride).to.equal(true);
      withSessionToken(user('SUPER_ADMIN'), null, 'sessions');
      expect((await access(tokenCaps())).canOverride).to.equal(false);
      withSessionToken(user('MEMBER'), null, 'admin,sessions');
      expect((await access(tokenCaps())).canOverride).to.equal(false);
      withSessionToken(user('MEMBER'));
      expect((await access(tokenCaps())).canOverride).to.equal(false);
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

    // The owner is looked up when the credential is checked: a key names them
    // only while they are ACTIVE, so a lookup that fails refuses the session
    // rather than run it as someone who may have been switched off.
    it('refuses the session when the owner lookup fails', async () => {
      withKey(keyRow('admin'), null);
      Container.set(UserService, { findById: sinon.stub().rejects(new Error('db down')) } as any);
      let error: Error | undefined;
      try {
        await invoke(svc, pairCaps());
      } catch (e: any) {
        error = e;
      }
      expect(error?.message).to.equal('db down');
    });

    it('is false, and the teams fall back to the shared pool, when the team lookup fails', async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      teamRows.rejects(new Error('db down'));
      expect(await access(pairCaps())).to.deep.equal({ canOverride: false, teamIds: [] });
    });

    it('is true when auth is disabled, where every caller is an admin', async () => {
      config.authDisabled = true;
      expect(await access(capsWith({}))).to.deep.equal({ canOverride: true, teamIds: undefined });
    });
  });

  describe('teamIds, as REST computes them', () => {
    it('is unscoped for an ADMIN or SUPER_ADMIN owner, whatever the key', async () => {
      withKey(keyRow('sessions', 'team_a'), user('ADMIN'));
      expect((await access(pairCaps())).teamIds).to.equal(undefined);
    });

    it("is the key's team when the key is narrowed", async () => {
      withKey(keyRow('sessions', 'team_a'), user('MEMBER'));
      expect((await access(pairCaps())).teamIds).to.deep.equal(['team_a']);
    });

    it("is the member's teams otherwise", async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      teamRows.resolves([{ teamId: 'team_a' }, { teamId: 'team_b' }] as any);
      expect((await access(pairCaps())).teamIds).to.deep.equal(['team_a', 'team_b']);
    });

    it("is a session token's team claim when it has one", async () => {
      withSessionToken(user('MEMBER'), 'team_b');
      expect((await access(tokenCaps())).teamIds).to.deep.equal(['team_b']);
    });
  });

  // Every session is allocated phones, and resolves uploaded apps, by the same
  // rule REST lists them by, whether or not it names a lease. A member's key
  // used to see only its own team binding, so a member with an ordinary key
  // never got their team's phones, and a session token saw every team's.
  describe("a session's own teams, as REST computes them", () => {
    const scope = async (caps: any) => {
      const res = await invoke(svc, caps);
      return { callerTeamIds: res.callerTeamIds, scoped: res.scoped };
    };

    it("is a member's teams for an ordinary key", async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      teamRows.resolves([{ teamId: 'team_a' }, { teamId: 'team_b' }] as any);
      expect(await scope(pairCaps())).to.deep.equal({
        callerTeamIds: ['team_a', 'team_b'],
        scoped: true,
      });
    });

    it('is only the shared pool for a member in no team', async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      expect(await scope(pairCaps())).to.deep.equal({ callerTeamIds: [], scoped: true });
    });

    it("is the key's team when the key is narrowed", async () => {
      withKey(keyRow('sessions', 'team_a'), user('MEMBER'));
      teamRows.resolves([{ teamId: 'team_a' }, { teamId: 'team_b' }] as any);
      expect(await scope(pairCaps())).to.deep.equal({ callerTeamIds: ['team_a'], scoped: true });
    });

    it('is unscoped for an ADMIN owner, as REST is, and for an admin-scoped key', async () => {
      withKey(keyRow('sessions'), user('ADMIN'));
      expect(await scope(pairCaps())).to.deep.equal({ callerTeamIds: undefined, scoped: false });
      withKey(keyRow('admin,sessions'), user('MEMBER'));
      expect((await scope(pairCaps())).scoped).to.equal(false);
    });

    it("is a session token's user's teams, not every team's", async () => {
      withSessionToken(user('MEMBER'));
      teamRows.resolves([{ teamId: 'team_a' }] as any);
      expect(await scope(tokenCaps())).to.deep.equal({ callerTeamIds: ['team_a'], scoped: true });
    });

    it("is a session token's team claim when it has one", async () => {
      withSessionToken(user('MEMBER'), 'team_b');
      expect(await scope(tokenCaps())).to.deep.equal({ callerTeamIds: ['team_b'], scoped: true });
    });

    it('lets xenon:team pick any team the member is in, and no other', async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      teamRows.resolves([{ teamId: 'team_a' }, { teamId: 'team_b' }] as any);
      const caps = () =>
        capsWith({ 'xe:options': { accessKey: 'ak', token: 'tk' }, 'xenon:team': 'team_b' });
      expect(await scope(caps())).to.deep.equal({ callerTeamIds: ['team_b'], scoped: true });
      const other = capsWith({
        'xe:options': { accessKey: 'ak', token: 'tk' },
        'xenon:team': 'team_c',
      });
      let error: Error | undefined;
      try {
        await invoke(svc, other);
      } catch (e: any) {
        error = e;
      }
      expect(error?.message).to.match(/not allowed/);
    });

    it('reads the team from xe:options.team, over a flat cap, and still checks it', async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      teamRows.resolves([{ teamId: 'team_a' }, { teamId: 'team_b' }] as any);
      const caps = (team: string) =>
        capsWith({
          'xe:options': { accessKey: 'ak', token: 'tk', team },
          'xenon:team': 'team_a',
        });
      expect(await scope(caps('team_b'))).to.deep.equal({
        callerTeamIds: ['team_b'],
        scoped: true,
      });
      let error: Error | undefined;
      try {
        await invoke(svc, caps('team_c'));
      } catch (e: any) {
        error = e;
      }
      expect(error?.message).to.equal("xe:options.team 'team_c' is not allowed for this API key");
    });

    it('falls back to the shared pool when the team lookup fails', async () => {
      withKey(keyRow('sessions'), user('MEMBER'));
      teamRows.rejects(new Error('db down'));
      expect(await scope(pairCaps())).to.deep.equal({ callerTeamIds: [], scoped: true });
    });

    it('stays unscoped, with no lookup, for a session with no credentials', async () => {
      Container.set(ApiKeyService, {
        verifyPair: sinon.stub().resolves(null),
        hasScope: () => false,
      } as any);
      findUser = sinon.stub();
      Container.set(UserService, { findById: findUser } as any);
      expect(await scope(capsWith({}))).to.deep.equal({ callerTeamIds: undefined, scoped: false });
      expect(findUser.called).to.equal(false);
    });
  });
});
