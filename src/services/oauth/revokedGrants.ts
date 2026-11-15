import { Service } from 'typedi';
import { prisma } from '../../prisma';
import { grantIsLive } from './grantLifetime';

/** How long a grant found live is taken as live without asking the database again. */
export const LIVE_GRANT_TTL_MS = 30_000;
/** Grants remembered at once, of each kind (live, and revoked or missing). Oldest go first. */
export const REMEMBERED_GRANTS_MAX = 10_000;

/**
 * Whether the sign-in grant an access token names (its `gid`) still stands,
 * for verifyBearerCredential, which REST, per-command auth and /xenon/mcp all
 * use. It sits on every request a signed-in agent makes, so the answer is
 * kept:
 *
 * - A grant found live is taken as live for LIVE_GRANT_TTL_MS (30 s).
 * - A grant revoked, lapsed (past its `expiresAt`, its maximum life or its
 *   idle window: GrantStore's rule, grantIsLive) or missing stays refused:
 *   none comes back. A grant's
 *   id is made with it, before any token names it, so a missing grant is one
 *   pruned after it ended.
 * - `revoked` (GrantStore.revoke, every revoke on this server) refuses the
 *   grant from then on, no wait. It is noted before the revoke is written, so
 *   a lookup that started before it can't put "live" back when it lands: the
 *   grant is refused, and a "live" answer is kept only if no revoke at all
 *   was noted while it was looked up.
 *
 * A revoke made by another server sharing the database is seen here within
 * the 30 s. A lookup that fails throws and keeps nothing, so the caller fails
 * closed, as for the user lookup beside it.
 */
@Service()
export class RevokedGrants {
  /** grant id -> when its "live" answer stops being trusted (ms). */
  private readonly live = new Map<string, number>();
  /** Grants refused for good: revoked here, or found revoked or missing. */
  private readonly refused = new Set<string>();
  /** Counts the revokes noted, so a lookup in flight during one keeps no answer. */
  private epoch = 0;

  /** How a grant is looked up; a spec replaces it. */
  lookup: (grantId: string) => Promise<boolean> = grantStands;
  /** The clock; a spec replaces it. */
  now: () => number = Date.now;

  /** Whether `grantId` stands: not revoked and not missing. Throws when it can't be told. */
  async isLive(grantId: string): Promise<boolean> {
    if (this.refused.has(grantId)) return false;
    const until = this.live.get(grantId);
    if (until !== undefined) {
      if (until > this.now()) return true;
      this.live.delete(grantId);
    }
    const epoch = this.epoch;
    const stands = await this.lookup(grantId);
    // Revoked while it was looked up: refused, whatever the lookup read.
    if (this.refused.has(grantId)) return false;
    if (!stands) {
      rememberRefused(this.refused, grantId);
      return false;
    }
    if (this.epoch === epoch) remember(this.live, grantId, this.now() + LIVE_GRANT_TTL_MS);
    return true;
  }

  /** The grant is being revoked: refused from now on. */
  revoked(grantId: string): void {
    this.epoch += 1;
    this.live.delete(grantId);
    rememberRefused(this.refused, grantId);
  }
}

/**
 * A grant's first row (never a spent one), live by GrantStore's own rule
 * (grantIsLive): unrevoked, and not past its `expiresAt`, its maximum life or
 * its idle window. Through 2.37's review a lapsed grant not yet pruned still
 * stood, so a day-long session token minted under it outlived the sign-in.
 */
async function grantStands(grantId: string): Promise<boolean> {
  const row = await prisma.mcpGrant.findUnique({
    where: { id: grantId },
    select: {
      revokedAt: true,
      rotatedFromId: true,
      expiresAt: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  return !!row && row.rotatedFromId === null && grantIsLive(row, Date.now());
}

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  while (map.size >= REMEMBERED_GRANTS_MAX) map.delete(map.keys().next().value as string);
  map.set(key, value);
}

function rememberRefused(set: Set<string>, key: string): void {
  set.delete(key);
  while (set.size >= REMEMBERED_GRANTS_MAX) set.delete(set.values().next().value as string);
  set.add(key);
}
