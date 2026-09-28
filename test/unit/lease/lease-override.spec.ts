import { expect } from 'chai';
import { canOverrideLease } from '../../../src/services/device-access/leaseOverride';

// Using a lease someone else created takes their phone, so it is an ownership
// override and follows resolveActor (actor.ts), not the role alone.

const user = (role: string) => ({ role });

describe('canOverrideLease — who may use a lease they did not create', () => {
  describe('an API key (xe:options pair)', () => {
    it("is refused for an ADMIN's key without the admin scope", () => {
      expect(
        canOverrideLease({ kind: 'api-key', scopes: 'devices,sessions,read', user: user('ADMIN') }),
      ).to.equal(false);
    });

    it("is allowed for the same ADMIN's key carrying the admin scope", () => {
      expect(
        canOverrideLease({ kind: 'api-key', scopes: 'admin,sessions', user: user('ADMIN') }),
      ).to.equal(true);
    });

    it("is allowed for a SUPER_ADMIN's key, whatever its scopes", () => {
      expect(
        canOverrideLease({ kind: 'api-key', scopes: 'sessions', user: user('SUPER_ADMIN') }),
      ).to.equal(true);
    });

    it("is refused for a member's key", () => {
      expect(
        canOverrideLease({ kind: 'api-key', scopes: 'sessions', user: user('MEMBER') }),
      ).to.equal(false);
    });

    it('reads scopes as a list, so a scope merely containing "admin" is not one', () => {
      expect(
        canOverrideLease({ kind: 'api-key', scopes: 'nonadmin,sessions', user: user('MEMBER') }),
      ).to.equal(false);
    });

    it('is refused when the key has no active owner, even with the admin scope', () => {
      expect(canOverrideLease({ kind: 'api-key', scopes: 'admin', user: null })).to.equal(false);
    });
  });

  describe('a session token (the user themselves, like a dashboard cookie)', () => {
    it('is allowed for an ADMIN or SUPER_ADMIN', () => {
      expect(canOverrideLease({ kind: 'session-token', user: user('ADMIN') })).to.equal(true);
      expect(canOverrideLease({ kind: 'session-token', user: user('SUPER_ADMIN') })).to.equal(true);
    });

    it('is refused for a member, or a user who is not active', () => {
      expect(canOverrideLease({ kind: 'session-token', user: user('MEMBER') })).to.equal(false);
      expect(canOverrideLease({ kind: 'session-token', user: null })).to.equal(false);
    });
  });

  it('is allowed with auth disabled, where every caller is a SUPER_ADMIN', () => {
    expect(canOverrideLease({ kind: 'auth-disabled' })).to.equal(true);
  });

  it('is refused to a session with no credentials', () => {
    expect(canOverrideLease({ kind: 'none' })).to.equal(false);
  });
});
