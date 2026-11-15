import { createHash, randomBytes, randomUUID } from 'crypto';
import { Container, Service } from 'typedi';
import { prisma, prismaTransactions } from '../../prisma';
import log from '../../logger';
import { RevokedGrants } from './revokedGrants';
import { DAY_MS, grantIsLive, refreshIdleMs, refreshMaxMs } from './grantLifetime';

// The limits and the liveness rule live in grantLifetime.ts, which
// revokedGrants.ts reads too (it can't import this module: this one imports it).
export {
  DEFAULT_REFRESH_IDLE_DAYS,
  DEFAULT_REFRESH_MAX_DAYS,
  refreshIdleMs,
  refreshMaxMs,
} from './grantLifetime';

/** A revoked grant's rows are kept this long, then deleted. */
const REVOKED_KEPT_MS = DAY_MS;
/** How often a store prunes dead grants, at most. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;

/**
 * How long a spent refresh token is remembered: the idle window
 * (refreshIdleMs), as long as the token could still have worked had it not
 * been exchanged. Presented again within it, it revokes its grant; after it,
 * it would have been refused anyway and is simply unknown. A sign-in that
 * refreshes hourly keeps about 720 such rows at the default 30 days.
 */
export function spentRefreshTokenMemoryMs(): number {
  return refreshIdleMs();
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
 *   Spent rows are kept for the idle window (spentRefreshTokenMemoryMs, 30
 *   days), as long as the token could have worked; an older one is unknown. `prune` runs from `create` and `rotate`, at most hourly.
 * - A grant ends 30 days after its last refresh or 90 days after it began
 *   (XENON_MCP_REFRESH_IDLE_DAYS, XENON_MCP_REFRESH_MAX_DAYS, read each time).
 *
 * `revoke` is the one way a grant is revoked; what else must happen then
 * (its leases, the access-token check) happens there.
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
      if (Date.now() - row.createdAt.getTime() >= spentRefreshTokenMemoryMs()) return 'invalid';
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

  /**
   * Revoke a grant, named by any of its rows, with every row of it. Nothing
   * for an unknown id. Every revoke comes here (the grants routes, a replayed
   * code or refresh token, an agent's own revocation, its user leaving), so
   * here is where it takes effect:
   *
   * - its access tokens are refused at once on this server (RevokedGrants,
   *   told before the write, so no check in flight can call it live after);
   * - its agent's leases end (`grant_revoked`, LeaseService.endLeasesOfGrant).
   *   A lease that can't be ended is logged and the revoke stands: the lease
   *   still ends at its own `expiresAt`, and its agent can no longer use it.
   *
   * Both run even when the grant was revoked already, so a revoke that failed
   * part way can be sent again.
   */
  async revoke(grantId: string, by: string): Promise<void> {
    const row = (await prisma.mcpGrant.findUnique({ where: { id: grantId } })) as GrantRow | null;
    if (!row) return;
    const id = row.rotatedFromId ?? row.id;
    Container.get(RevokedGrants).revoked(id);
    const r = await prisma.mcpGrant.updateMany({
      where: { OR: [{ id }, { rotatedFromId: id }], revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count > 0) this.log.info(`revoked agent sign-in ${id} (${by})`);
    try {
      // Loaded here, not imported: LeaseService imports most of the server.
      const { LeaseService } = await import('../lease/LeaseService');
      await Container.get(LeaseService).endLeasesOfGrant(id, 'grant_revoked');
    } catch (err: any) {
      this.log.warn(`could not end the leases of revoked sign-in ${id}: ${err?.message ?? err}`);
    }
  }

  /**
   * Revoke every unrevoked grant of a user, each through `revoke`, past its
   * limits or not: one that can no longer refresh may still have an access
   * token of its last hour, and leases. Answers how many.
   */
  async revokeAllOf(userId: string, by = 'all_of_user'): Promise<number> {
    const rows = (await prisma.mcpGrant.findMany({
      where: { userId, rotatedFromId: null, revokedAt: null },
      select: { id: true },
    })) as Array<{ id: string }>;
    for (const row of rows) await this.revoke(row.id, by);
    return rows.length;
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
   * Delete spent tokens older than the idle window (spentRefreshTokenMemoryMs), and grants
   * past their limits or revoked a day ago, with their spent rows.
   */
  async prune(): Promise<number> {
    const now = Date.now();
    const spent = await prisma.mcpGrant.deleteMany({
      where: {
        rotatedFromId: { not: null },
        createdAt: { lt: new Date(now - spentRefreshTokenMemoryMs()) },
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
    return grantIsLive(row, now);
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
