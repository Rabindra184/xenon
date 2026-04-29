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

  // Returns the row when the token is valid, unexpired, and unused. Otherwise
  // returns null. Does NOT consume — call consume(id) separately after the
  // password update succeeds.
  async verifyToken(raw: string): Promise<{ id: string; userId: string } | null> {
    if (!raw) return null;
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row) return null;
    if (row.usedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return { id: row.id, userId: row.userId };
  }

  async consume(id: string): Promise<void> {
    await prisma.passwordResetToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
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
