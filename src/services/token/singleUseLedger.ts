import type { JWTPayload } from 'jose';

/**
 * JwtKeyService.verify's clock tolerance, in ms. A token stays verifiable
 * until `exp` plus this, so a jti has to be remembered at least that long.
 */
const VERIFY_CLOCK_TOLERANCE_MS = 60_000;

/**
 * Remembers which single-use tickets have been redeemed, by `jti`.
 *
 * Shared by the stream and app-download tickets so the eviction rule lives in
 * one place. An entry is dropped only once the JWT itself can no longer be
 * verified: its own `exp` plus the verifier's clock tolerance. Evicting at
 * redeem time + TTL instead would forget the jti while `verify()` still
 * accepts the token, and a replay inside that gap would be accepted.
 *
 * In memory, so a restart forgets what was used; tickets are short-lived and
 * the signing key survives restarts, which bounds that to one TTL.
 */
export class SingleUseLedger {
  // jti -> epoch-ms after which the token can no longer verify. Pruned on each consume.
  private used = new Map<string, number>();

  /** @param fallbackTtlSec used only for a payload with no numeric `exp`. */
  constructor(private readonly fallbackTtlSec: number) {}

  /** Records the ticket as used. Throws `ticket already used` on a second call. */
  consume(payload: JWTPayload): void {
    const jti = String(payload.jti);
    const now = Date.now();
    for (const [k, exp] of this.used) if (exp < now) this.used.delete(k);
    if (this.used.has(jti)) throw new Error('ticket already used');
    const expiresAt =
      typeof payload.exp === 'number' ? payload.exp * 1000 : now + this.fallbackTtlSec * 1000;
    this.used.set(jti, expiresAt + VERIFY_CLOCK_TOLERANCE_MS);
  }
}
