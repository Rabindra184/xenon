import { expect } from 'chai';
import type { Request } from 'express';
import {
  effectiveRole,
  isAdminCaller,
  isGrantBound,
  isSuperAdminCaller,
} from '../../src/middleware/callerRole';
import { resolveActor } from '../../src/services/device-access/actor';
import { canOverrideLease } from '../../src/services/device-access/leaseOverride';

/**
 * A grant-bound caller (an agent's browser sign-in: its credential names a
 * grant) is judged as a MEMBER wherever Xenon decides whether a caller is an
 * admin, whatever its user's role and whatever scopes it carries. Every other
 * credential is judged by its user's role, as before.
 */
describe('callerRole: an agent signed in by an admin is judged as a member', () => {
  it('effectiveRole: the role, except a grant-bound admin is a MEMBER', () => {
    expect(effectiveRole({ role: 'SUPER_ADMIN' })).to.equal('SUPER_ADMIN');
    expect(effectiveRole({ role: 'ADMIN' })).to.equal('ADMIN');
    expect(effectiveRole({ role: 'MEMBER' })).to.equal('MEMBER');
    expect(effectiveRole({ role: 'SUPER_ADMIN', grantId: 'g1' })).to.equal('MEMBER');
    expect(effectiveRole({ role: 'ADMIN', grantId: 'g1' })).to.equal('MEMBER');
    expect(effectiveRole({ role: 'MEMBER', grantId: 'g1' })).to.equal('MEMBER');
    // An empty grant id names no grant.
    expect(effectiveRole({ role: 'ADMIN', grantId: '' })).to.equal('ADMIN');
    expect(effectiveRole({ role: 'OWNER' })).to.equal(undefined);
    expect(effectiveRole(undefined)).to.equal(undefined);
  });

  it('isAdminCaller / isSuperAdminCaller / isGrantBound', () => {
    expect(isAdminCaller({ role: 'ADMIN' })).to.equal(true);
    expect(isAdminCaller({ role: 'SUPER_ADMIN' })).to.equal(true);
    expect(isAdminCaller({ role: 'ADMIN', grantId: 'g' })).to.equal(false);
    expect(isAdminCaller({ role: 'SUPER_ADMIN', grantId: 'g' })).to.equal(false);
    expect(isSuperAdminCaller({ role: 'SUPER_ADMIN' })).to.equal(true);
    expect(isSuperAdminCaller({ role: 'SUPER_ADMIN', grantId: 'g' })).to.equal(false);
    expect(isGrantBound('g')).to.equal(true);
    expect(isGrantBound('')).to.equal(false);
    expect(isGrantBound(undefined)).to.equal(false);
  });

  const reqWith = (auth: Record<string, unknown>) => ({ auth }) as unknown as Request;

  it('resolveActor: a grant-bound caller is never an admin, even with the admin scope', () => {
    expect(
      resolveActor(reqWith({ userId: 'u', role: 'SUPER_ADMIN', scopes: 'devices' })).isAdmin,
    ).to.equal(true);
    expect(resolveActor(reqWith({ userId: 'u', role: 'ADMIN', scopes: 'admin' })).isAdmin).to.equal(
      true,
    );
    expect(
      resolveActor(reqWith({ userId: 'u', role: 'ADMIN', scopes: 'devices' })).isAdmin,
    ).to.equal(false);
    expect(
      resolveActor(reqWith({ userId: 'u', role: 'SUPER_ADMIN', scopes: 'devices', grantId: 'g' }))
        .isAdmin,
    ).to.equal(false);
    // A grant never carries `admin`; if one did, it still isn't an admin.
    expect(
      resolveActor(reqWith({ userId: 'u', role: 'ADMIN', scopes: 'admin,devices', grantId: 'g' }))
        .isAdmin,
    ).to.equal(false);
  });

  it('canOverrideLease: never under a grant, for either kind of credential', () => {
    for (const kind of ['api-key', 'session-token'] as const) {
      expect(
        canOverrideLease({ kind, scopes: 'sessions', user: { role: 'SUPER_ADMIN' } }),
      ).to.equal(true);
      expect(
        canOverrideLease({ kind, scopes: 'sessions', user: { role: 'SUPER_ADMIN' }, grantId: 'g' }),
      ).to.equal(false);
      expect(
        canOverrideLease({ kind, scopes: 'admin,sessions', user: { role: 'ADMIN' }, grantId: 'g' }),
      ).to.equal(false);
    }
  });
});
