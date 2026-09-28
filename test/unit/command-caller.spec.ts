import { expect } from 'chai';
import sinon from 'sinon';
import {
  CALLER_CACHE_TTL_MS,
  CommandCallerVerifier,
  readPresentedCredential,
} from '../../src/middleware/commandCaller';

/**
 * Who is calling a WebDriver command, as the per-command check sees it.
 *
 * The verifier checks the credentials REST accepts, through the same helpers
 * authMiddleware uses, and remembers a verified identity for 30 s keyed by a
 * SHA-256 of what was presented. Stubs stand in for those helpers here; the
 * helpers themselves are covered by verify-credential.spec.ts.
 */

const ACCESS_KEY = 'xen_access_key_alice';
const TOKEN = 'raw-api-token-that-must-never-be-stored';
const JWT = 'eyJhbGciOiJSUzI1NiJ9.payload.signature-that-must-never-be-stored';

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    userId: 'alice',
    scopes: 'devices,sessions,read',
    expiresAt: null,
    ...overrides,
  } as any;
}
const user = (id: string, role: string) => ({ id, role, status: 'ACTIVE' });

describe('readPresentedCredential', () => {
  it('reads the header pair', () => {
    expect(
      readPresentedCredential({ 'x-xenon-access-key': ACCESS_KEY, 'x-xenon-token': TOKEN }),
    ).to.deep.equal({ kind: 'key-pair', accessKey: ACCESS_KEY, token: TOKEN });
  });

  it('reads a Bearer token', () => {
    expect(readPresentedCredential({ authorization: `Bearer ${JWT}` })).to.deep.equal({
      kind: 'bearer',
      token: JWT,
    });
  });

  it('prefers the pair when both are sent, as authMiddleware does', () => {
    expect(
      readPresentedCredential({
        'x-xenon-access-key': ACCESS_KEY,
        'x-xenon-token': TOKEN,
        authorization: `Bearer ${JWT}`,
      }).kind,
    ).to.equal('key-pair');
  });

  it('ignores half a pair and falls through to Bearer', () => {
    expect(
      readPresentedCredential({ 'x-xenon-token': TOKEN, authorization: `Bearer ${JWT}` }).kind,
    ).to.equal('bearer');
  });

  it('sees no credentials in half a pair, another auth scheme, or a cookie', () => {
    expect(readPresentedCredential({ 'x-xenon-access-key': ACCESS_KEY }).kind).to.equal('none');
    expect(readPresentedCredential({ authorization: 'Basic dXNlcjpwYXNz' }).kind).to.equal('none');
    expect(readPresentedCredential({ cookie: 'xenon_dashboard_session=abc' }).kind).to.equal(
      'none',
    );
    expect(readPresentedCredential({}).kind).to.equal('none');
  });
});

describe('CommandCallerVerifier', () => {
  let clock: number;
  let verifyKeyPair: sinon.SinonStub;
  let verifyBearer: sinon.SinonStub;

  function verifier(extra: Record<string, unknown> = {}) {
    return new CommandCallerVerifier({
      verifyKeyPair,
      verifyBearer,
      now: () => clock,
      ...extra,
    });
  }
  const pair = (accessKey = ACCESS_KEY, token = TOKEN) =>
    ({ kind: 'key-pair', accessKey, token }) as const;
  const bearer = (token = JWT) => ({ kind: 'bearer', token }) as const;

  beforeEach(() => {
    clock = 1_000_000;
    verifyKeyPair = sinon.stub().resolves({ row: keyRow(), user: user('alice', 'MEMBER') });
    verifyBearer = sinon.stub().resolves({
      payload: {
        sub: 'alice',
        scopes: 'devices,sessions,read',
        exp: Math.floor(clock / 1000) + 3600,
      },
      user: user('alice', 'MEMBER'),
    });
  });

  describe('identity and the override rule', () => {
    it('returns the key owner as the caller', async () => {
      const verdict = await verifier().verify(pair());
      expect(verdict).to.deep.equal({
        valid: true,
        caller: { userId: 'alice', overrideAdmin: false },
      });
      expect(verifyKeyPair.calledOnceWith(ACCESS_KEY, TOKEN)).to.equal(true);
    });

    it('returns the token subject as the caller', async () => {
      const verdict = await verifier().verify(bearer());
      expect(verdict).to.deep.equal({
        valid: true,
        caller: { userId: 'alice', overrideAdmin: false },
      });
      expect(verifyBearer.calledOnceWith(JWT)).to.equal(true);
    });

    it('reports a credential that does not verify as invalid', async () => {
      verifyKeyPair.resolves(null);
      expect(await verifier().verify(pair())).to.deep.equal({ valid: false });
    });

    const cases: Array<[string, string, string, boolean]> = [
      ['a SUPER_ADMIN, whatever the scopes', 'SUPER_ADMIN', 'sessions', true],
      ['an admin-scoped credential', 'ADMIN', 'admin,devices,sessions,read', true],
      ["an ADMIN's ordinary credential", 'ADMIN', 'devices,sessions,read', false],
      ['a MEMBER', 'MEMBER', 'devices,sessions,read', false],
    ];
    for (const [label, role, scopes, expected] of cases) {
      it(`${expected ? 'overrides' : 'does not override'} for ${label} (key pair)`, async () => {
        verifyKeyPair.resolves({ row: keyRow({ scopes }), user: user('u', role) });
        const verdict: any = await verifier().verify(pair());
        expect(verdict.caller.overrideAdmin).to.equal(expected);
      });

      it(`${expected ? 'overrides' : 'does not override'} for ${label} (Bearer)`, async () => {
        verifyBearer.resolves({ payload: { sub: 'u', scopes }, user: user('u', role) });
        const verdict: any = await verifier().verify(bearer());
        expect(verdict.caller.overrideAdmin).to.equal(expected);
      });
    }

    it('judges a Bearer token by its scopes claim, so an ADMIN cannot mint an override from an ordinary key', async () => {
      // /auth/token copies the minting credential's scopes into the token. An
      // ADMIN's ordinary key mints a token without `admin`, which must stay a
      // non-override exactly as the key itself is.
      verifyBearer.resolves({ payload: { sub: 'u' }, user: user('u', 'ADMIN') });
      const verdict: any = await verifier().verify(bearer());
      expect(verdict.caller.overrideAdmin).to.equal(false);
    });
  });

  describe('the 30 s cache', () => {
    it('serves a verified credential from cache within 30 s', async () => {
      const v = verifier();
      await v.verify(pair());
      clock += CALLER_CACHE_TTL_MS - 1;
      const verdict = await v.verify(pair());
      expect(verdict).to.deep.equal({
        valid: true,
        caller: { userId: 'alice', overrideAdmin: false },
      });
      expect(verifyKeyPair.callCount).to.equal(1);
    });

    it('verifies again once 30 s have passed', async () => {
      const v = verifier();
      await v.verify(pair());
      clock += CALLER_CACHE_TTL_MS;
      await v.verify(pair());
      expect(verifyKeyPair.callCount).to.equal(2);
    });

    it('sees a revocation within 30 s', async () => {
      const v = verifier();
      await v.verify(pair());
      verifyKeyPair.resolves(null); // key revoked, or its user disabled
      clock += CALLER_CACHE_TTL_MS;
      expect(await v.verify(pair())).to.deep.equal({ valid: false });
    });

    it('never keeps a key past its own expiry', async () => {
      verifyKeyPair.resolves({
        row: keyRow({ expiresAt: new Date(clock + 5_000) }),
        user: user('alice', 'MEMBER'),
      });
      const v = verifier();
      await v.verify(pair());
      clock += 5_000;
      await v.verify(pair());
      expect(verifyKeyPair.callCount).to.equal(2);
    });

    it('never keeps a token past its exp claim', async () => {
      verifyBearer.resolves({
        payload: { sub: 'alice', exp: Math.floor(clock / 1000) + 5 },
        user: user('alice', 'MEMBER'),
      });
      const v = verifier();
      await v.verify(bearer());
      clock += 5_000;
      await v.verify(bearer());
      expect(verifyBearer.callCount).to.equal(2);
    });

    it('does not cache a credential that failed', async () => {
      verifyKeyPair.resolves(null);
      const v = verifier();
      await v.verify(pair());
      verifyKeyPair.resolves({ row: keyRow(), user: user('alice', 'MEMBER') });
      expect((await v.verify(pair())).valid).to.equal(true);
      expect(verifyKeyPair.callCount).to.equal(2);
    });

    it('does not cache a check that could not run, and lets its error through', async () => {
      verifyKeyPair.rejects(new Error('db down'));
      const v = verifier();
      let caught: unknown;
      try {
        await v.verify(pair());
      } catch (err) {
        caught = err;
      }
      expect(String(caught)).to.match(/db down/);
      verifyKeyPair.resolves({ row: keyRow(), user: user('alice', 'MEMBER') });
      expect((await v.verify(pair())).valid).to.equal(true);
    });

    it('keys a pair on the access key as well as the token', async () => {
      // A cache keyed on the token alone would let a caller with the right
      // token and a wrong access key skip the pair check.
      const v = verifier();
      await v.verify(pair(ACCESS_KEY, TOKEN));
      verifyKeyPair.resolves(null);
      expect(await v.verify(pair('xen_someone_else', TOKEN))).to.deep.equal({ valid: false });
    });

    it('keeps pair and Bearer entries apart', async () => {
      const v = verifier();
      await v.verify(bearer(TOKEN));
      await v.verify(pair(ACCESS_KEY, TOKEN));
      expect(verifyBearer.callCount).to.equal(1);
      expect(verifyKeyPair.callCount).to.equal(1);
    });

    it('stores a SHA-256 of the secret, never the secret', async () => {
      const v = verifier();
      await v.verify(pair());
      await v.verify(bearer());
      const stored = JSON.stringify([...(v as any).cache.entries()]);
      expect(stored).not.to.include(TOKEN);
      expect(stored).not.to.include(ACCESS_KEY);
      expect(stored).not.to.include(JWT);
      for (const key of (v as any).cache.keys()) expect(key).to.match(/^[0-9a-f]{64}$/);
    });

    it('is bounded, dropping the oldest entries first', async () => {
      const v = verifier({ maxEntries: 3 });
      for (const t of ['t1', 't2', 't3', 't4', 't5']) await v.verify(pair(ACCESS_KEY, t));
      expect((v as any).cache.size).to.equal(3);

      verifyKeyPair.resetHistory();
      await v.verify(pair(ACCESS_KEY, 't5')); // newest: still cached
      expect(verifyKeyPair.callCount).to.equal(0);
      await v.verify(pair(ACCESS_KEY, 't1')); // oldest: dropped
      expect(verifyKeyPair.callCount).to.equal(1);
    });

    it('drops expired entries before evicting live ones', async () => {
      const v = verifier({ maxEntries: 2 });
      await v.verify(pair(ACCESS_KEY, 'a')); // oldest, live for 30 s
      verifyKeyPair.resolves({
        row: keyRow({ expiresAt: new Date(clock + 1_000) }),
        user: user('alice', 'MEMBER'),
      });
      await v.verify(pair(ACCESS_KEY, 'short')); // newer, but its key expires in 1 s
      clock += 2_000;
      verifyKeyPair.resolves({ row: keyRow(), user: user('alice', 'MEMBER') });
      await v.verify(pair(ACCESS_KEY, 'b')); // full: 'short' has expired and goes, 'a' stays

      verifyKeyPair.resetHistory();
      await v.verify(pair(ACCESS_KEY, 'a'));
      await v.verify(pair(ACCESS_KEY, 'b'));
      expect(verifyKeyPair.callCount).to.equal(0);
    });
  });
});
