import { expect } from 'chai';
import {
  AUTH_DISABLED_USER_ID,
  resolveEffectiveUserId,
} from '../../src/app/routers/profileIdentity';

describe('resolveEffectiveUserId', () => {
  it('passes a real authenticated user id through unchanged', () => {
    expect(resolveEffectiveUserId('user-123', 'admin-1')).to.equal('user-123');
    // A real user id wins even when no admin was looked up.
    expect(resolveEffectiveUserId('user-123', null)).to.equal('user-123');
  });

  it('resolves the auth-disabled synthetic id to the seeded admin', () => {
    expect(resolveEffectiveUserId(AUTH_DISABLED_USER_ID, 'admin-1')).to.equal('admin-1');
  });

  it('returns null when auth is disabled and there is no admin to fall back to', () => {
    expect(resolveEffectiveUserId(AUTH_DISABLED_USER_ID, null)).to.equal(null);
  });

  it('treats empty/undefined userId like the disabled case (falls back to admin)', () => {
    expect(resolveEffectiveUserId('', 'admin-1')).to.equal('admin-1');
    expect(resolveEffectiveUserId(undefined, 'admin-1')).to.equal('admin-1');
    expect(resolveEffectiveUserId(null, null)).to.equal(null);
  });

  it('keeps the sentinel constant stable (authMiddleware contract)', () => {
    expect(AUTH_DISABLED_USER_ID).to.equal('auth-disabled');
  });
});
