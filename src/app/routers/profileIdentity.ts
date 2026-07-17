/**
 * Synthetic userId that authMiddleware assigns when authentication is disabled
 * (see src/middleware/authMiddleware.ts). No User row has this id.
 */
export const AUTH_DISABLED_USER_ID = 'auth-disabled';

/**
 * Resolve the effective User id for profile / access-key / token operations.
 *
 * Auth-disabled mode issues the synthetic `auth-disabled` userId, which has no
 * backing User row — so looking it up 404s. In that mode the caller is treated
 * as the seeded bootstrap SUPER_ADMIN, so token/access-key management acts as
 * that admin ("auth disabled = act as the admin"). A real authenticated user's
 * id passes through unchanged.
 *
 * @param rawUserId    req.auth.userId as set by authMiddleware.
 * @param firstAdminId id of the first/seeded SUPER_ADMIN, or null if none exists.
 * @returns the User id to operate on, or null if nothing can be resolved.
 */
export function resolveEffectiveUserId(
  rawUserId: string | undefined | null,
  firstAdminId: string | null,
): string | null {
  if (rawUserId && rawUserId !== AUTH_DISABLED_USER_ID) return rawUserId;
  return firstAdminId;
}
