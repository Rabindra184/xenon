import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
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
