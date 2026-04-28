import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';

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

  async resolve(sessionId: string) {
    const row = await prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    const newExpiresAt = new Date(Date.now() + this.ttlMs());
    // Fire-and-forget sliding-TTL update; failures must not block auth.
    prisma.userSession
      .update({
        where: { id: sessionId },
        data: { expiresAt: newExpiresAt, lastSeenAt: new Date() },
      })
      .catch(() => undefined);
    return row;
  }

  async revoke(sessionId: string) {
    await prisma.userSession.delete({ where: { id: sessionId } }).catch(() => undefined);
  }

  async revokeAllForUserExcept(userId: string, keepSessionId: string) {
    await prisma.userSession.deleteMany({
      where: { userId, NOT: { id: keepSessionId } },
    });
  }

  async cleanupExpired(): Promise<number> {
    const r = await prisma.userSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (r.count > 0) this.log.info(`cleaned ${r.count} expired user sessions`);
    return r.count;
  }
}
