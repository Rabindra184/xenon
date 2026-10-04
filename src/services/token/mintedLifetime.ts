/**
 * Nothing a credential mints outlives it.
 *
 * `credentialExpiresAt` is req.auth.credentialExpiresAt: when the credential
 * making the request stops working (a Bearer token's `exp`, an API key's
 * `expiresAt`), as epoch ms, or undefined for one that doesn't expire (a key
 * without an expiry, a dashboard sign-in, which renews itself).
 *
 * Through 2.14 a 1-hour Bearer token could make itself an API key that never
 * expired (POST /profile/tokens, POST /apikeys), or mint a fresh 1-hour token
 * before it expired, and so on for ever (POST /auth/token).
 */

/**
 * A minted token's lifetime in seconds: `defaultSec`, cut to what is left of
 * the credential minting it, less a second so the minted token's `exp`
 * can't round past it. Throws when nothing is left.
 */
export function mintedLifetimeSec(defaultSec: number, credentialExpiresAt?: number): number {
  if (credentialExpiresAt === undefined) return defaultSec;
  const left = Math.floor((credentialExpiresAt - Date.now()) / 1000) - 1;
  if (left < 1) throw new Error('the credential used to mint this token has expired');
  return Math.min(defaultSec, left);
}

/**
 * An API key's expiry, made with a credential that may itself expire: the
 * expiry asked for, or the credential's when none was asked for; an error
 * when the one asked for is later than the credential's.
 */
export function keyExpiryWithin(
  requested: Date | undefined,
  credentialExpiresAt?: number,
): { expiresAt: Date | undefined } | { error: string } {
  if (credentialExpiresAt === undefined) return { expiresAt: requested };
  if (requested && requested.getTime() > credentialExpiresAt) {
    return {
      error:
        'expiresAt can be no later than the credential you are using, which expires at ' +
        new Date(credentialExpiresAt).toISOString(),
    };
  }
  return { expiresAt: requested ?? new Date(credentialExpiresAt) };
}
