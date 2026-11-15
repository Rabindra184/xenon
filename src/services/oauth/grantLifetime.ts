import log from '../../logger';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_REFRESH_IDLE_DAYS = 30;
export const DEFAULT_REFRESH_MAX_DAYS = 90;

const warned = new Set<string>();

/** A whole number of days above 0 from `name`, else `fallback` (warned once). */
function daysFrom(name: string, fallback: number): number {
  const text = process.env[name]?.trim() ?? '';
  if (text === '') return fallback;
  const days = /^\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isSafeInteger(days) && days > 0) return days;
  if (!warned.has(`${name}=${text}`)) {
    warned.add(`${name}=${text}`);
    log.warn(
      `${name} is "${text}", not a whole number of days above 0. ` +
        `An agent's sign-in uses the default, ${fallback} days.`,
    );
  }
  return fallback;
}

/** A refresh token unused this long stops working: XENON_MCP_REFRESH_IDLE_DAYS, 30 days. */
export function refreshIdleMs(): number {
  return daysFrom('XENON_MCP_REFRESH_IDLE_DAYS', DEFAULT_REFRESH_IDLE_DAYS) * DAY_MS;
}

/** A sign-in ends this long after it began, however often it refreshed: XENON_MCP_REFRESH_MAX_DAYS, 90 days. */
export function refreshMaxMs(): number {
  return daysFrom('XENON_MCP_REFRESH_MAX_DAYS', DEFAULT_REFRESH_MAX_DAYS) * DAY_MS;
}

/**
 * Whether a grant (its first row) is live at `now`: not revoked, not past
 * its own `expiresAt`, not past XENON_MCP_REFRESH_MAX_DAYS from its start,
 * and used within XENON_MCP_REFRESH_IDLE_DAYS. The one rule GrantStore
 * refreshes by and RevokedGrants checks every token's `gid` by, so a lapsed
 * grant that hasn't been pruned yet is refused as a revoked one is.
 */
export function grantIsLive(
  row: { revokedAt: Date | null; expiresAt: Date; createdAt: Date; lastUsedAt: Date },
  now: number,
): boolean {
  if (row.revokedAt) return false;
  if (now >= row.expiresAt.getTime()) return false;
  if (now - row.createdAt.getTime() >= refreshMaxMs()) return false;
  return now - row.lastUsedAt.getTime() < refreshIdleMs();
}
