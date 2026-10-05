import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';
import { identityChanged } from './identity/identityChanges';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

@Service()
export class UserSessionService {
  private log = log.scope('UserSession');

  ttlMs(): number {
    return Number(process.env.XENON_USER_SESSION_TTL_MS) || DEFAULT_TTL_MS;
  }

  async create(userId: string, meta: { userAgent?: string; ipHash?: string } = {}) {
    const expiresAt = new Date(Date.now() + this.ttlMs());
    return prisma.userSession.create({
      data: { userId, expiresAt, userAgent: meta.userAgent, ipHash: meta.ipHash },
    });
  }

  /**
   * The sign-in, if it exists and hasn't expired. A use of it renews it
   * (sliding TTL); `renew: false` only looks, for a check that isn't a use: a
   * socket's re-check must not keep a sign-in alive for as long as a tab is open.
   */
  async resolve(sessionId: string, { renew = true }: { renew?: boolean } = {}) {
    const row = await prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    if (!renew) return row;
    const newExpiresAt = new Date(Date.now() + this.ttlMs());
    // Fire-and-forget sliding-TTL update; failures must not block auth, but
    // log them at debug level so chronic write issues are diagnosable.
    prisma.userSession
      .update({
        where: { id: sessionId },
        data: { expiresAt: newExpiresAt, lastSeenAt: new Date() },
      })
      .catch((e) => this.log.debug(`sliding TTL update failed for session ${sessionId}: ${(e as Error)?.message ?? e}`));
    return row;
  }

  // Idempotent by design — logout must always 'succeed' from the caller's
  // perspective. P2025 (record not found) means the row was already gone,
  // which is fine. Other errors get logged for diagnosis but don't bubble.
  async revoke(sessionId: string) {
    const row = await prisma.userSession.delete({ where: { id: sessionId } }).catch((e) => {
      const code = (e as { code?: string })?.code;
      if (code === 'P2025') return null;
      this.log.warn(`revoke: unexpected delete error for session ${sessionId}: ${(e as Error)?.message ?? e}`);
      return null;
    });
    await identityChanged(row?.userId);
  }

  async revokeAllForUserExcept(userId: string, keepSessionId: string): Promise<number> {
    const r = await prisma.userSession.deleteMany({
      where: { userId, NOT: { id: keepSessionId } },
    });
    if (r.count > 0) {
      this.log.info(`revoked ${r.count} sessions for user ${userId} (kept ${keepSessionId})`);
      await identityChanged(userId);
    }
    return r.count;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const r = await prisma.userSession.deleteMany({ where: { userId } });
    if (r.count > 0) {
      this.log.info(`revoked all ${r.count} sessions for user ${userId}`);
      await identityChanged(userId);
    }
    return r.count;
  }

  async cleanupExpired(): Promise<number> {
    const r = await prisma.userSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    // Routine maintenance — debug level so hourly cron doesn't spam ops logs.
    if (r.count > 0) this.log.debug(`cleaned ${r.count} expired user sessions`);
    return r.count;
  }
}
