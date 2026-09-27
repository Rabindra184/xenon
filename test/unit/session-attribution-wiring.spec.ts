import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { UserService } from '../../src/services/UserService';
import { config } from '../../src/config';

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
    Container.set(UserService, { findById: sinon.stub().resolves(null) } as any);
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

// isAdmin decides whether a session may use a lease it did not create. It is
// its own field, not `!scoped`: a credential-less session is unscoped too, and
// treating that as admin would hand every lease to anyone.
describe('authorizeSessionRequest — isAdmin', () => {
  let svc: any;
  let authDisabledBefore: boolean;

  const keyRow = (scopes: string) => ({
    id: 'key_abc',
    userId: 'usr_alice',
    scopes,
    teamId: null,
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
    Container.set(UserService, { findById: sinon.stub().resolves(owner) } as any);
  };

  const withSessionToken = (owner: any) => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      hasScope: () => false,
    } as any);
    Container.set(JwtKeyService, { verify: sinon.stub().resolves({ sub: 'usr_alice' }) } as any);
    Container.set(UserService, { findById: sinon.stub().resolves(owner) } as any);
  };

  const pairCaps = capsWith({ 'df:options': { accessKey: 'ak', token: 'tk' } });
  const tokenCaps = capsWith({ 'xenon:options': { sessionToken: 'tok' } });

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

  it('is true for a key carrying the admin scope', async () => {
    withKey(keyRow('admin'), user('MEMBER'));
    expect((await invoke(svc, pairCaps)).isAdmin).to.equal(true);
  });

  it('is true for a key whose user is an ADMIN or SUPER_ADMIN', async () => {
    withKey(keyRow('sessions'), user('ADMIN'));
    expect((await invoke(svc, pairCaps)).isAdmin).to.equal(true);
    withKey(keyRow('sessions'), user('SUPER_ADMIN'));
    expect((await invoke(svc, pairCaps)).isAdmin).to.equal(true);
  });

  it("is false for a member's key", async () => {
    withKey(keyRow('sessions'), user('MEMBER'));
    expect((await invoke(svc, pairCaps)).isAdmin).to.equal(false);
  });

  it('is false for an admin whose account is not active', async () => {
    withKey(keyRow('sessions'), user('ADMIN', 'INACTIVE'));
    expect((await invoke(svc, pairCaps)).isAdmin).to.equal(false);
  });

  it('follows the role of a session-token caller', async () => {
    withSessionToken(user('ADMIN'));
    expect((await invoke(svc, tokenCaps)).isAdmin).to.equal(true);
    withSessionToken(user('MEMBER'));
    expect((await invoke(svc, tokenCaps)).isAdmin).to.equal(false);
  });

  it('is false for a credential-less session, even though it is unscoped', async () => {
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      hasScope: () => false,
    } as any);

    const res = await invoke(svc, capsWith({}));

    expect(res.scoped).to.equal(false);
    expect(res.isAdmin).to.equal(false);
  });

  it('is false when the role lookup fails', async () => {
    withKey(keyRow('sessions'), null);
    Container.set(UserService, { findById: sinon.stub().rejects(new Error('db down')) } as any);
    expect((await invoke(svc, pairCaps)).isAdmin).to.equal(false);
  });

  it('is true when auth is disabled, where every caller is an admin', async () => {
    config.authDisabled = true;
    expect((await invoke(svc, capsWith({}))).isAdmin).to.equal(true);
  });
});
