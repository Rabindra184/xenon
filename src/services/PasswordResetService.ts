import { Service } from 'typedi';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { config } from '../config';
import log from '../logger';

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

@Service()
export class PasswordResetService {
  private log = log.scope('PasswordReset');

  ttlMs(): number {
    return (config as any).resetTokenTtlMs ?? DEFAULT_TTL_MS;
  }

  // Returns { raw, id }. The raw token is what gets emailed; the DB stores
  // only its sha256 hash. This is the same primitive ApiKeyService uses for
  // its 32-byte tokens — high entropy, no salt needed.
  async createToken(userId: string): Promise<{ raw: string; id: string }> {
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + this.ttlMs());
    const row = await prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    });
    return { raw, id: row.id };
  }

  // Returns the row when the token is valid, unexpired and unused, and its
  // user is Active. Otherwise returns null. An Inactive user can't sign in, so
  // their link is refused as an invalid one. Does NOT spend the link: claim(id)
  // does, before the password changes.
  async verifyToken(raw: string): Promise<{ id: string; userId: string } | null> {
    if (!raw) return null;
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const row = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { status: true } } },
    });
    if (!row) return null;
    if (row.usedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    if (row.user?.status !== 'ACTIVE') return null;
    return { id: row.id, userId: row.userId };
  }

  /**
   * Spend the link: one conditional write that only an unused, unexpired link
   * of an Active user passes. True for exactly one caller however many send
   * the link at once, so the password changes only after this answers true.
   * Through 2.36 the link was marked used after the password changed, by an
   * unconditional write: two resets sent together with one link both passed
   * the check, both changed the password, and the last one won.
   */
  async claim(id: string): Promise<boolean> {
    const now = new Date();
    const r = await prisma.passwordResetToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: now }, user: { status: 'ACTIVE' } },
      data: { usedAt: now },
    });
    return r.count === 1;
  }

  /**
   * Kill every outstanding reset link for a user. Call whenever their password
   * changes: a link issued earlier (and possibly leaked, e.g. into a log)
   * must not still work afterwards. Previously it stayed live for its full hour
   * even after the password had been reset with a newer link.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const r = await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return r.count;
  }

  async cleanupExpired(): Promise<number> {
    const r = await prisma.passwordResetToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }],
      },
    });
    if (r.count > 0) this.log.debug(`cleaned ${r.count} expired/used reset tokens`);
    return r.count;
  }
}
