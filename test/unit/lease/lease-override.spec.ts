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

  // A session token carries the scopes of the credential that minted it, and
  // is judged by them like a key. By role alone, an ADMIN's key without the
  // admin scope minted itself a token that could override.
  describe("a session token (judged by its scopes and its user's role now)", () => {
    // resolveActor's rule (a SUPER_ADMIN, or a credential with `admin`), on
    // the user's role now: the scope is fixed at mint, so an ADMIN's token
    // also needs the role to still be ADMIN, which notices a demotion.
    it("is allowed for an ADMIN's or SUPER_ADMIN's token carrying the admin scope", () => {
      for (const role of ['ADMIN', 'SUPER_ADMIN']) {
        expect(
          canOverrideLease({ kind: 'session-token', scopes: 'admin,sessions', user: user(role) }),
        ).to.equal(true);
      }
    });

    // As their key pair overrides, and their Bearer token in per-command auth.
    it("is allowed for a SUPER_ADMIN's token without the admin scope", () => {
      expect(
        canOverrideLease({ kind: 'session-token', scopes: 'sessions', user: user('SUPER_ADMIN') }),
      ).to.equal(true);
    });

    it('is refused for a token with the admin scope whose user is now a member', () => {
      expect(
        canOverrideLease({ kind: 'session-token', scopes: 'admin,sessions', user: user('MEMBER') }),
      ).to.equal(false);
    });

    it("is refused for an ADMIN's token without the admin scope", () => {
      expect(
        canOverrideLease({ kind: 'session-token', scopes: 'sessions', user: user('ADMIN') }),
      ).to.equal(false);
    });

    it('is refused for a member, or a user who is not active', () => {
      expect(
        canOverrideLease({ kind: 'session-token', scopes: 'sessions', user: user('MEMBER') }),
      ).to.equal(false);
      expect(canOverrideLease({ kind: 'session-token', scopes: 'admin', user: null })).to.equal(
        false,
      );
    });
  });

  it('is allowed with auth disabled, where every caller is a SUPER_ADMIN', () => {
    expect(canOverrideLease({ kind: 'auth-disabled' })).to.equal(true);
  });

  it('is refused to a session with no credentials', () => {
    expect(canOverrideLease({ kind: 'none' })).to.equal(false);
  });
});
