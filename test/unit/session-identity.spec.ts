import { expect } from 'chai';
import { resolveSessionIdentity } from '../../src/services/session/sessionIdentity';

// A session's owner is resolved by the device ownership guard as
// Session.user_id (preferred) or Session.api_key_id -> ApiKey.userId. When
// neither is set the guard fails closed and denies EVERYONE non-admin —
// including the engineer who started the run. Before this change, a session
// authenticated by a xenon:options.sessionToken was verified and then had its
// identity discarded, so exactly that happened.

const KEY_ROW = { id: 'key_abc', userId: 'usr_alice' };

/** Stand-in for JwtKeyService.verify — resolves a payload or throws. */
const verifyOk = (payload: Record<string, unknown>) => async () => payload;
const verifyThrows = async () => {
  throw new Error('signature verification failed');
};

describe('resolveSessionIdentity', () => {
  it('populates both ids from a verified df:options key pair', async () => {
    const id = await resolveSessionIdentity({
      row: KEY_ROW,
      sessionToken: null,
      verify: verifyThrows,
    });
    expect(id).to.deep.equal({ apiKeyId: 'key_abc', userId: 'usr_alice' });
  });

  it('prefers the key pair over a token when both are present', async () => {
    const id = await resolveSessionIdentity({
      row: KEY_ROW,
      sessionToken: 'tok',
      verify: verifyOk({ sub: 'usr_bob' }),
    });
    expect(id).to.deep.equal({ apiKeyId: 'key_abc', userId: 'usr_alice' });
  });

  it('takes the userId from a verified session token', async () => {
    const id = await resolveSessionIdentity({
      row: null,
      sessionToken: 'tok',
      verify: verifyOk({ sub: 'usr_carol' }),
    });
    expect(id).to.deep.equal({ apiKeyId: null, userId: 'usr_carol' });
  });

  it('ignores a token that fails verification', async () => {
    const id = await resolveSessionIdentity({
      row: null,
      sessionToken: 'forged',
      verify: verifyThrows,
    });
    expect(id).to.deep.equal({ apiKeyId: null, userId: null });
  });

  it('ignores a verified token with no sub', async () => {
    const id = await resolveSessionIdentity({
      row: null,
      sessionToken: 'tok',
      verify: verifyOk({ teamId: 't1' }),
    });
    expect(id).to.deep.equal({ apiKeyId: null, userId: null });
  });

  it('ignores a verified token whose sub is empty', async () => {
    const id = await resolveSessionIdentity({
      row: null,
      sessionToken: 'tok',
      verify: verifyOk({ sub: '' }),
    });
    expect(id).to.deep.equal({ apiKeyId: null, userId: null });
  });

  it('ignores a verified token whose sub is not a string', async () => {
    const id = await resolveSessionIdentity({
      row: null,
      sessionToken: 'tok',
      verify: verifyOk({ sub: 12345 }),
    });
    expect(id).to.deep.equal({ apiKeyId: null, userId: null });
  });

  it('returns both null when no credential is presented', async () => {
    const id = await resolveSessionIdentity({
      row: null,
      sessionToken: null,
      verify: verifyThrows,
    });
    expect(id).to.deep.equal({ apiKeyId: null, userId: null });
  });

  it('does not call verify when there is no token', async () => {
    let called = false;
    await resolveSessionIdentity({
      row: null,
      sessionToken: null,
      verify: async () => {
        called = true;
        return {};
      },
    });
    expect(called).to.equal(false);
  });
});
