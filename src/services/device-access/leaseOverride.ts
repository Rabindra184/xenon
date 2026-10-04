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
 * A session token needs both: the `admin` scope, which it carries only when
 * the credential that minted it had it (POST /auth/token, the default or a
 * full-admin grant), and its user's role now, ADMIN or SUPER_ADMIN. The scope
 * is fixed at mint and the token lives up to a day, so the live role is what
 * notices an admin demoted since. Through 2.14 it was judged by its user's
 * role alone, so an ADMIN's key without the admin scope minted itself a token
 * that could override.
 *
 * `user` is the credential's owner, or null when there is none or the account
 * is not ACTIVE; either way nothing is overridden. Which phones the session
 * can see is a separate question (`isDeviceVisible`), with no admin exception.
 */
export type LeaseOverrideCredential =
  | { kind: 'auth-disabled' }
  | { kind: 'api-key' | 'session-token'; scopes: string; user: { role: string } | null }
  | { kind: 'none' };

export function canOverrideLease(credential: LeaseOverrideCredential): boolean {
  switch (credential.kind) {
    case 'auth-disabled':
      return true;
    case 'api-key':
    case 'session-token': {
      if (!credential.user) return false;
      const scopes = new Set(credential.scopes.split(',').map((s) => s.trim()));
      const { role } = credential.user;
      if (credential.kind === 'session-token') {
        return scopes.has('admin') && (role === 'ADMIN' || role === 'SUPER_ADMIN');
      }
      return scopes.has('admin') || role === 'SUPER_ADMIN';
    }
    default:
      return false;
  }
}
