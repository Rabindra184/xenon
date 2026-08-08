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
      select: { api_key_id: true },
    });
    if (!session?.api_key_id) return null;

    const key = await this.db.apiKey.findUnique({
      where: { id: session.api_key_id },
      select: { userId: true },
    });
    const owner: string | null = key?.userId ?? null;
    if (owner) this.remember(this.ownerCache, sessionId, owner);
    return owner;
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
