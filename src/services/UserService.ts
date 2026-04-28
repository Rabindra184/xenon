import { Service } from 'typedi';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import log from '../logger';

const ACCESS_KEY_PREFIX = 'xen_';
const ACCESS_KEY_LEN = 12;
const PASSWORD_MIN = 8;
const ACCESS_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

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
}
