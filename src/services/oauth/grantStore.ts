import { createHash, randomBytes, randomUUID } from 'crypto';
import { Service } from 'typedi';
import { prisma, prismaTransactions } from '../../prisma';
import log from '../../logger';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_REFRESH_IDLE_DAYS = 30;
export const DEFAULT_REFRESH_MAX_DAYS = 90;
/** A revoked grant's rows are kept this long, then deleted. */
const REVOKED_KEPT_MS = DAY_MS;
/**
 * How long a spent refresh token is remembered: presented again within it,
 * it revokes its grant; after it, it is simply unknown. Bounds the rows a
 * long sign-in keeps (a week of hourly refreshes is about 170).
 */
export const SPENT_REFRESH_TOKEN_MEMORY_MS = 7 * DAY_MS;
/** How often a store prunes dead grants, at most. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;

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

/** The stored form of a refresh token: its SHA-256, hex. */
export function refreshTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

function scopesOf(text: string): string[] {
  return text.split(' ').filter(Boolean);
}

/** A grant as the dashboard lists it: never its token hash. */
export interface GrantSummary {
  id: string;
  userId: string;
  clientId: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

/** A rotation that worked: the grant (same id as before) and its new refresh token. */
export interface Rotated {
  grantId: string;
  refreshToken: string;
  userId: string;
  clientId: string;
  scopes: string[];
}

type GrantRow = {
  id: string;
  userId: string;
  clientId: string;
  scopes: string;
  tokenHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedFromId: string | null;
};

function summary(row: GrantRow): GrantSummary {
  return {
    id: row.id,
    userId: row.userId,
    clientId: row.clientId,
    scopes: scopesOf(row.scopes),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * An agent's sign-ins (`McpGrant`): one grant per sign-in, whose id is the
 * `gid` of every access token it gives, the same for the sign-in's whole
 * life, so a lease taken under it (`Lease.grantId`) stays its own.
 *
 * - The grant's row (`rotatedFromId` null) holds the current refresh token's
 *   SHA-256; the token itself is never stored.
 * - Each refresh replaces that hash in one conditional update (a claim: two
 *   refreshes with one token can't both win) and adds a spent row holding
 *   the old hash, with `rotatedFromId` naming the grant.
 * - A token that matches a spent row was presented a second time: the whole
 *   grant is revoked, every row with it (RFC 9700 §4.14.2).
 *   Spent rows are kept SPENT_REFRESH_TOKEN_MEMORY_MS (7 days); an older one
 *   is unknown. `prune` runs from `create` and `rotate`, at most hourly.
 * - A grant ends 30 days after its last refresh or 90 days after it began
 *   (XENON_MCP_REFRESH_IDLE_DAYS, XENON_MCP_REFRESH_MAX_DAYS, read each time).
 *
 * `revoke` is the one way a grant is revoked; what else must happen then
 * (its leases, the access-token check) hooks there.
 */
@Service()
export class GrantStore {
  private log = log.scope('OAuthGrants');
  private lastPrune = 0;

  async create(
    userId: string,
    clientId: string,
    scopes: string[],
  ): Promise<{ grantId: string; refreshToken: string }> {
    await this.pruneNowAndThen();
    const now = new Date();
    const refreshToken = newRefreshToken();
    const grantId = randomUUID();
    await prisma.mcpGrant.create({
      data: {
        id: grantId,
        userId,
        clientId,
        scopes: scopes.join(' '),
        tokenHash: refreshTokenHash(refreshToken),
        createdAt: now,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + refreshMaxMs()),
      },
    });
    this.log.info(`agent sign-in ${grantId} for user ${userId} (client ${clientId})`);
    return { grantId, refreshToken };
  }

  /**
   * Exchange a refresh token for a new one. `'invalid'` for a token that was
   * never given, is past its limits, belongs to a revoked grant or to another
   * client than `opts.clientId` (which leaves it usable by its own);
   * `'reused'` for one already exchanged, after revoking its grant.
   */
  async rotate(
    refreshToken: string,
    opts: { clientId?: string } = {},
  ): Promise<Rotated | 'reused' | 'invalid'> {
    await this.pruneNowAndThen();
    const presented = refreshTokenHash(refreshToken);
    const row = (await prisma.mcpGrant.findFirst({
      where: { tokenHash: presented },
    })) as GrantRow | null;
    if (!row) return 'invalid';
    if (row.rotatedFromId) {
      if (Date.now() - row.createdAt.getTime() >= SPENT_REFRESH_TOKEN_MEMORY_MS) return 'invalid';
      await this.revoke(row.rotatedFromId, 'refresh_token_reused');
      return 'reused';
    }
    if (opts.clientId !== undefined && row.clientId !== opts.clientId) return 'invalid';
    if (!this.isLive(row, Date.now())) return 'invalid';

    const now = new Date();
    const next = newRefreshToken();
    const won = await prismaTransactions.$transaction(async (tx: any) => {
      const claim = await tx.mcpGrant.updateMany({
        where: { id: row.id, tokenHash: presented, revokedAt: null },
        data: { tokenHash: refreshTokenHash(next), lastUsedAt: now },
      });
      if (claim.count !== 1) return false;
      await tx.mcpGrant.create({
        data: {
          id: randomUUID(),
          userId: row.userId,
          clientId: row.clientId,
          scopes: row.scopes,
          tokenHash: presented,
          createdAt: now,
          lastUsedAt: now,
          expiresAt: row.expiresAt,
          revokedAt: now,
          rotatedFromId: row.id,
        },
      });
      return true;
    });
    if (!won) {
      // Exchanged by another request in between: the same token twice.
      await this.revoke(row.id, 'refresh_token_reused');
      return 'reused';
    }
    return {
      grantId: row.id,
      refreshToken: next,
      userId: row.userId,
      clientId: row.clientId,
      scopes: scopesOf(row.scopes),
    };
  }

  /** The grant (its first row), revoked or not; null for no such grant. */
  async find(grantId: string): Promise<(GrantSummary & { revokedAt: Date | null }) | null> {
    const row = (await prisma.mcpGrant.findUnique({ where: { id: grantId } })) as GrantRow | null;
    if (!row || row.rotatedFromId) return null;
    return { ...summary(row), revokedAt: row.revokedAt };
  }

  /**
   * The live grant a refresh token belongs to, without using the token; null
   * for none. `spent` when the token is one the grant already exchanged.
   */
  async grantOfRefreshToken(
    refreshToken: string,
  ): Promise<(GrantSummary & { spent: boolean }) | null> {
    const row = (await prisma.mcpGrant.findFirst({
      where: { tokenHash: refreshTokenHash(refreshToken) },
    })) as GrantRow | null;
    if (!row) return null;
    const grant = row.rotatedFromId
      ? ((await prisma.mcpGrant.findUnique({
          where: { id: row.rotatedFromId },
        })) as GrantRow | null)
      : row;
    if (!grant || !this.isLive(grant, Date.now())) return null;
    return { ...summary(grant), spent: row.rotatedFromId !== null };
  }

  /** Revoke a grant, named by any of its rows, with every row of it. Nothing for an unknown id. */
  async revoke(grantId: string, by: string): Promise<void> {
    const row = (await prisma.mcpGrant.findUnique({ where: { id: grantId } })) as GrantRow | null;
    if (!row) return;
    const id = row.rotatedFromId ?? row.id;
    const r = await prisma.mcpGrant.updateMany({
      where: { OR: [{ id }, { rotatedFromId: id }], revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count > 0) this.log.info(`revoked agent sign-in ${id} (${by})`);
  }

  /** Revoke every live grant of a user, each through `revoke`. Answers how many. */
  async revokeAllOf(userId: string, by = 'all_of_user'): Promise<number> {
    const live = await this.listOf(userId);
    for (const grant of live) await this.revoke(grant.id, by);
    return live.length;
  }

  /** A user's live grants, most recently used first. */
  async listOf(userId: string): Promise<GrantSummary[]> {
    const rows = (await prisma.mcpGrant.findMany({
      where: { userId, rotatedFromId: null, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    })) as GrantRow[];
    const now = Date.now();
    return rows.filter((r) => this.isLive(r, now)).map(summary);
  }

  /** The clients that hold a live grant: a registration that must not be evicted. */
  async clientsWithLiveGrants(): Promise<Set<string>> {
    const now = Date.now();
    const rows = await prisma.mcpGrant.findMany({
      where: {
        rotatedFromId: null,
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
        createdAt: { gt: new Date(now - refreshMaxMs()) },
        lastUsedAt: { gt: new Date(now - refreshIdleMs()) },
      },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    return new Set(rows.map((r: { clientId: string }) => r.clientId));
  }

  /**
   * Delete spent tokens older than SPENT_REFRESH_TOKEN_MEMORY_MS, and grants
   * past their limits or revoked a day ago, with their spent rows.
   */
  async prune(): Promise<number> {
    const now = Date.now();
    const spent = await prisma.mcpGrant.deleteMany({
      where: {
        rotatedFromId: { not: null },
        createdAt: { lt: new Date(now - SPENT_REFRESH_TOKEN_MEMORY_MS) },
      },
    });
    const dead = await prisma.mcpGrant.findMany({
      where: {
        rotatedFromId: null,
        OR: [
          { expiresAt: { lt: new Date(now) } },
          { createdAt: { lt: new Date(now - refreshMaxMs()) } },
          { lastUsedAt: { lt: new Date(now - refreshIdleMs()) } },
          { revokedAt: { lt: new Date(now - REVOKED_KEPT_MS) } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    if (dead.length === 0) return spent.count;
    const ids = dead.map((d: { id: string }) => d.id);
    const r = await prisma.mcpGrant.deleteMany({
      where: { OR: [{ id: { in: ids } }, { rotatedFromId: { in: ids } }] },
    });
    return spent.count + r.count;
  }

  private isLive(row: GrantRow, now: number): boolean {
    if (row.revokedAt) return false;
    if (now >= row.expiresAt.getTime()) return false;
    if (now - row.createdAt.getTime() >= refreshMaxMs()) return false;
    return now - row.lastUsedAt.getTime() < refreshIdleMs();
  }

  private async pruneNowAndThen(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    await this.prune().catch((err) =>
      this.log.debug(`could not prune old agent sign-ins: ${err?.message ?? err}`),
    );
  }
}
