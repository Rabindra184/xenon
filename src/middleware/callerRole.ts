import type { UserRole } from '../types/identity';

/**
 * What a caller's admin rights are judged by: the user's role, and the
 * sign-in grant its credential was issued under, if any (`req.auth.grantId`,
 * an MCP caller's `grantId`, a verified token's `gid`).
 */
export interface CallerRoleInput {
  role?: UserRole | string | null;
  grantId?: string | null;
}

/** Whether a credential came from an agent's browser sign-in (it names a grant). */
export function isGrantBound(grantId: string | null | undefined): boolean {
  return typeof grantId === 'string' && grantId !== '';
}

/**
 * The role a caller is judged as wherever Xenon decides "is this caller an
 * admin": its user's role, except that a grant-bound caller (an agent's
 * browser sign-in) is judged as a MEMBER, whatever its user's role.
 *
 * An admin who signs an agent in through the browser hands it member rights
 * plus every team's phones, never admin rights: the consent page doesn't
 * say "and administer the lab", and an agent asks for every scope the hub
 * lists. Team visibility (`computeTeamIds`, `req.auth.teamIds`) still follows
 * the user's role and must not be routed through this. An admin who wants an
 * agent to administer the lab gives it an API key.
 *
 * `undefined` for no role or one Xenon doesn't know.
 */
export function effectiveRole(caller: CallerRoleInput | null | undefined): UserRole | undefined {
  const role = caller?.role;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'MEMBER') return undefined;
  if (role !== 'MEMBER' && isGrantBound(caller?.grantId)) return 'MEMBER';
  return role;
}

/** An ADMIN or a SUPER_ADMIN, by effectiveRole: never a grant-bound caller. */
export function isAdminCaller(caller: CallerRoleInput | null | undefined): boolean {
  const role = effectiveRole(caller);
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

/** A SUPER_ADMIN, by effectiveRole: never a grant-bound caller. */
export function isSuperAdminCaller(caller: CallerRoleInput | null | undefined): boolean {
  return effectiveRole(caller) === 'SUPER_ADMIN';
}
