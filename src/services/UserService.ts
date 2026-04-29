import { Service } from 'typedi';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import log from '../logger';
import { prisma } from '../prisma';
import type { UserRole, UserStatus } from '../types/identity';

const ACCESS_KEY_PREFIX = 'xen_';
const ACCESS_KEY_LEN = 12;
const PASSWORD_MIN = 8;
const ACCESS_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

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

  async rotateAccessKey(userId: string) {
    const accessKey = this.generateAccessKey();
    return prisma.user.update({
      where: { id: userId },
      data: { accessKey },
      select: { id: true, accessKey: true },
    });
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
}
