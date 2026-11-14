import { Service } from 'typedi';
// Pure JavaScript, so it needs no install script: npm 12 skips a dependency's
// install scripts unless the installing project allows them, and Appium's home
// allows none. Through 2.17 this was the native `bcrypt`, whose binary only
// its install script downloads, and the plugin then failed to load. The hashes
// are the same `$2b$` format both ways.
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import log from '../logger';
import { prisma } from '../prisma';
import { Prisma } from '../generated/client';
import type { UserRole, UserStatus } from '../types/identity';
import { identityChanged } from './identity/identityChanges';
import { assertNotLastSuperAdmin } from './identity/userAuthorization';

const ACCESS_KEY_PREFIX = 'xen_';
const ACCESS_KEY_LEN = 12;
const PASSWORD_MIN = 8;
const ACCESS_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// Tries of a change that keeps a super-admin, on Postgres's serialization
// failure (P2034). The next try reads what the other change committed.
const SUPER_ADMIN_CHANGE_ATTEMPTS = 3;

function isWriteConflict(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'P2034';
}

export interface CreateUserParams {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
  status?: UserStatus;
}

@Service()
export class UserService {
  private log = log.scope('User');

  // Cost is overridable for tests so suites don't take 30s.
  bcryptCost = Number(process.env.XENON_BCRYPT_COST) || 12;

  /**
   * Run a change that could remove an active SUPER_ADMIN (a demotion, a
   * deactivation, a delete) in one transaction with the check that another
   * active one stays: when the target is a SUPER_ADMIN, assertNotLastSuperAdmin
   * counts the other active ones, before the change and in the same
   * transaction. Throws LastSuperAdminError, writing nothing, when none would
   * stay.
   *
   * Serializable: SQLite runs these transactions one at a time, and Postgres
   * fails one of two that read each other's rows (P2034); that one is tried
   * again and then sees the other's change. Through 2.36 the router counted,
   * then changed, outside any transaction, so two changes at once to the last
   * two super-admins both passed the count and left none.
   */
  private async keepingASuperAdmin<T>(
    userId: string,
    change: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const target = await tx.user.findUnique({
              where: { id: userId },
              select: { role: true },
            });
            if (target?.role === 'SUPER_ADMIN') {
              await assertNotLastSuperAdmin(userId, tx);
            }
            return change(tx);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (e) {
        if (isWriteConflict(e) && attempt < SUPER_ADMIN_CHANGE_ATTEMPTS) continue;
        throw e;
      }
    }
  }

  async hashPassword(password: string): Promise<string> {
    if (!password || password.length < PASSWORD_MIN) {
      throw new Error(`password must be at least ${PASSWORD_MIN} characters`);
    }
    return bcrypt.hash(password, this.bcryptCost);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) return false;
    return bcrypt.compare(password, hash);
  }

  generateAccessKey(): string {
    const bytes = crypto.randomBytes(ACCESS_KEY_LEN);
    let s = '';
    for (let i = 0; i < ACCESS_KEY_LEN; i++) {
      s += ACCESS_KEY_ALPHABET[bytes[i] % ACCESS_KEY_ALPHABET.length];
    }
    return ACCESS_KEY_PREFIX + s;
  }

  // CONTRACT: every User insertion path (this method, bootstrap, and any
  // future migration) must lowercase email before writing — User.email is
  // unique, and the application treats addresses as case-insensitive.
  async createUser(p: CreateUserParams) {
    const passwordHash = await this.hashPassword(p.password);
    const accessKey = this.generateAccessKey();
    return prisma.user.create({
      data: {
        email: p.email.toLowerCase(),
        name: p.name,
        passwordHash,
        accessKey,
        role: p.role ?? 'MEMBER',
        status: p.status ?? 'ACTIVE',
      },
    });
  }

  async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findByAccessKey(accessKey: string) {
    return prisma.user.findUnique({ where: { accessKey } });
  }

  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  // The old access key's (accessKey, token) pairs stop working, a node's
  // socket's included.
  async rotateAccessKey(userId: string) {
    const accessKey = this.generateAccessKey();
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { accessKey },
      select: { id: true, accessKey: true },
    });
    await identityChanged(userId);
    return updated;
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new Error('user not found');
    if (!u.passwordHash) {
      // Distinguish "no password on file" from "wrong password" so the
      // operator / support flow can tell a corrupted account apart from a
      // typo. Bootstrap-reset env var is the recovery path.
      throw new Error('password has not been set on this account');
    }
    if (!(await this.verifyPassword(oldPassword, u.passwordHash))) {
      throw new Error('incorrect current password');
    }
    const passwordHash = await this.hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
  }

  // Login-side-effect: never block sign-in on a write failure here. Log
  // the failure so chronic DB issues are visible in operator logs.
  async setLastLoginAt(userId: string) {
    await prisma.user
      .update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      })
      .catch((e) => this.log.warn(`failed to update lastLoginAt for ${userId}: ${(e as Error)?.message ?? e}`));
  }

  async listUsers(callerRole: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER') {
    const where = callerRole === 'SUPER_ADMIN' ? {} : { role: 'MEMBER' as const };
    return prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // PATCH-shaped update. Email is intentionally dropped — it's immutable post-create.
  // A demotion or deactivation of the last active SUPER_ADMIN throws
  // LastSuperAdminError and changes nothing.
  async updateUser(
    userId: string,
    patch: {
      name?: string;
      role?: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
      status?: 'ACTIVE' | 'INACTIVE';
    },
  ) {
    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.role !== undefined) data.role = patch.role;
    if (patch.status !== undefined) data.status = patch.status;
    const demotes = patch.role !== undefined && patch.role !== 'SUPER_ADMIN';
    const deactivates = patch.status === 'INACTIVE';
    const updated =
      demotes || deactivates
        ? await this.keepingASuperAdmin(userId, (tx) =>
            tx.user.update({ where: { id: userId }, data }),
          )
        : await prisma.user.update({ where: { id: userId }, data });
    await identityChanged(userId);
    return updated;
  }

  async setRole(userId: string, role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER') {
    const updated =
      role === 'SUPER_ADMIN'
        ? await prisma.user.update({ where: { id: userId }, data: { role } })
        : await this.keepingASuperAdmin(userId, (tx) =>
            tx.user.update({ where: { id: userId }, data: { role } }),
          );
    await identityChanged(userId);
    return updated;
  }

  async deactivateUser(userId: string): Promise<void> {
    await this.keepingASuperAdmin(userId, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });
      await tx.userSession.deleteMany({ where: { userId } });
    });
    await identityChanged(userId);
  }

  async deleteUser(userId: string): Promise<void> {
    // Defense in depth — cascade also clears UserSessions, but doing it
    // explicitly first lets us emit the revocation log line and avoids
    // relying on cascade semantics for security-critical cleanup.
    await this.keepingASuperAdmin(userId, async (tx) => {
      await tx.userSession.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
    await identityChanged(userId);
  }
}
