/**
 * May an Appium session use a lease it did not create?
 *
 * That takes a phone from the user who leased it, so it is an ownership
 * override, and it follows the rule `resolveActor` (actor.ts) applies to every
 * other one: a SUPER_ADMIN, or a credential carrying the `admin` scope. An
 * ADMIN's API key is not enough on its own. profile.ts never lets an ADMIN
 * mint the admin scope ("the admin's CI token shouldn't auto-grant 'admin'",
 * authMiddleware.ts), and deviceAccessGuard refuses such a key another user's
 * device, so a lease must not be the way around that.
 *
 * A session token is the user themselves, as a dashboard cookie is, and
 * `scopesForRole` gives a cookie ADMIN the admin scope; so a session-token
 * caller overrides as an ADMIN or SUPER_ADMIN.
 *
 * `user` is the credential's owner, or null when there is none or the account
 * is not ACTIVE; either way nothing is overridden. Which phones the session
 * can see is a separate question (`isDeviceVisible`), with no admin exception.
 */
export type LeaseOverrideCredential =
  | { kind: 'auth-disabled' }
  | { kind: 'api-key'; scopes: string; user: { role: string } | null }
  | { kind: 'session-token'; user: { role: string } | null }
  | { kind: 'none' };

export function canOverrideLease(credential: LeaseOverrideCredential): boolean {
  switch (credential.kind) {
    case 'auth-disabled':
      return true;
    case 'api-key': {
      if (!credential.user) return false;
      const scopes = new Set(credential.scopes.split(',').map((s) => s.trim()));
      return scopes.has('admin') || credential.user.role === 'SUPER_ADMIN';
    }
    case 'session-token':
      return credential.user?.role === 'SUPER_ADMIN' || credential.user?.role === 'ADMIN';
    default:
      return false;
  }
}
