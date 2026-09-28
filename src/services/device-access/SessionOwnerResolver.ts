import { Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';

/** Bound so a long-lived server cannot accumulate entries without limit. */
const MAX_CACHE_ENTRIES = 500;

/**
 * Resolves who owns a running Appium session, and how to name them.
 *
 * `Session.api_key_id` records the key that created the session; the owning
 * human is `ApiKey.userId`. Comparing at user level is what lets a dashboard
 * (cookie) caller be recognised as the owner of a session they started with an
 * SDK key.
 *
 * Only positive results are cached. Session ownership never changes for a
 * given session id, so a resolved owner cannot go stale — but a *negative*
 * result can simply mean the Session row has not been written yet, and caching
 * that would deny the owner their own device for the life of the process.
 */
@Service()
export class SessionOwnerResolver {
  private ownerCache = new Map<string, string>();
  private nameCache = new Map<string, string>();

  constructor(private readonly db: any = defaultPrisma) {}

  async ownerOf(sessionId: string): Promise<string | null> {
    if (!sessionId) return null;
    const cached = this.ownerCache.get(sessionId);
    if (cached) return cached;

    const session = await this.db.session.findUnique({
      where: { id: sessionId },
      select: { api_key_id: true, user_id: true },
    });

    // Preferred: the session recorded its owner directly (written from either
    // credential path since the attribution change). Rows created before that
    // have user_id null and still resolve through the ApiKey hop below.
    let owner: string | null = session?.user_id ?? null;

    if (!owner && session?.api_key_id) {
      const key = await this.db.apiKey.findUnique({
        where: { id: session.api_key_id },
        select: { userId: true },
      });
      owner = key?.userId ?? null;
    }

    if (owner) this.remember(this.ownerCache, sessionId, owner);
    return owner;
  }

  /**
   * The owner of each of several sessions, by exactly ownerOf's rule, in one
   * query: one `session.findMany` for the ids not already cached, plus one
   * `apiKey.findMany` only if some of those rows predate `user_id`. Used to
   * filter Appium's session listing, where an ownerOf per listed session would
   * be a query per session.
   *
   * Every requested id is in the result, null when no owner is on record.
   * Shares ownerOf's cache, with the same rule: only resolved owners are kept.
   * A failed query rejects; nothing is guessed.
   */
  async ownersOf(sessionIds: readonly string[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(sessionIds)];
    const resolved = new Map<string, string | null>();
    const missing: string[] = [];
    for (const id of ids) {
      const cached = id ? this.ownerCache.get(id) : undefined;
      if (cached) resolved.set(id, cached);
      else if (id) missing.push(id);
      else resolved.set(id, null);
    }

    if (missing.length > 0) {
      const rows: Array<{ id: string; api_key_id: string | null; user_id: string | null }> =
        await this.db.session.findMany({
          where: { id: { in: missing } },
          select: { id: true, api_key_id: true, user_id: true },
        });
      const byId = new Map(rows.map((row) => [row.id, row]));

      // Rows written before user_id existed resolve through the key, as in ownerOf.
      const legacyKeyIds = [
        ...new Set(
          rows
            .filter((row) => !row.user_id && row.api_key_id)
            .map((row) => row.api_key_id as string),
        ),
      ];
      const keyOwner = new Map<string, string>();
      if (legacyKeyIds.length > 0) {
        const keys: Array<{ id: string; userId: string | null }> = await this.db.apiKey.findMany({
          where: { id: { in: legacyKeyIds } },
          select: { id: true, userId: true },
        });
        for (const key of keys) if (key.userId) keyOwner.set(key.id, key.userId);
      }

      for (const id of missing) {
        const row = byId.get(id);
        const owner =
          row?.user_id ?? (row?.api_key_id ? (keyOwner.get(row.api_key_id) ?? null) : null);
        resolved.set(id, owner);
        if (owner) this.remember(this.ownerCache, id, owner);
      }
    }

    // In the order asked, so a caller filtering a list keeps its order.
    return new Map(ids.map((id) => [id, resolved.get(id) ?? null]));
  }

  async displayName(userId: string): Promise<string | null> {
    if (!userId) return null;
    const cached = this.nameCache.get(userId);
    if (cached) return cached;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    const label: string | null = user?.email ?? user?.name ?? null;
    if (label) this.remember(this.nameCache, userId, label);
    return label;
  }

  clear(): void {
    this.ownerCache.clear();
    this.nameCache.clear();
  }

  private remember(cache: Map<string, string>, key: string, value: string): void {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(key, value);
  }
}
