import { Service } from 'typedi';
import crypto from 'crypto';
import { prisma } from '../prisma';
import log from '../logger';

export type Scope = 'read' | 'sessions' | 'devices' | 'admin';

export interface ApiKeyRow {
  id: string;
  name: string;
  keyHash: string;
  scopes: string;
  rateLimit: number;
  revokedAt: Date | null;
  expiresAt: Date | null;
  teamId?: string | null;
  role?: string;
  userId: string;
}

@Service()
export class ApiKeyService {
  private log = log.scope('ApiKey');

  // Plain SHA-256 (no salt, no key-stretching) is correct for tokens
  // produced by generateRaw() — they are 32 random bytes (~256 bits of
  // entropy) so preimage resistance is the only property we need. DO NOT
  // copy this pattern for password hashing — passwords are low-entropy
  // and need bcrypt (see UserService.hashPassword).
  hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  generateRaw(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async verify(raw: string | undefined): Promise<ApiKeyRow | null> {
    if (!raw) return null;
    const row = await prisma.apiKey.findUnique({ where: { keyHash: this.hash(raw) } });
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return row as ApiKeyRow;
  }

  hasScope(row: ApiKeyRow, required: Scope[]): boolean {
    const owned = new Set(row.scopes.split(',').map((s) => s.trim()));
    if (owned.has('admin')) return true;
    return required.some((r) => owned.has(r));
  }

  async create(params: {
    name: string;
    scopes: Scope[];
    rateLimit?: number;
    teamId?: string | null;
    userId: string;
    // Optional hard-stop timestamp. Tokens whose expiresAt is in the past
    // are rejected by verify() / verifyPair() — same fail-closed shape as
    // a revoked row. Pass undefined for no expiry.
    expiresAt?: Date;
  }): Promise<{ id: string; raw: string }> {
    const raw = this.generateRaw();
    const row = await prisma.apiKey.create({
      data: {
        name: params.name,
        keyHash: this.hash(raw),
        scopes: params.scopes.join(','),
        rateLimit: params.rateLimit ?? 300,
        teamId: params.teamId ?? null,
        userId: params.userId,
        expiresAt: params.expiresAt ?? null,
      },
    });
    return { id: row.id, raw };
  }

  async verifyPair(accessKey: string, token: string): Promise<ApiKeyRow | null> {
    if (!accessKey || !token) return null;
    const user = await prisma.user.findUnique({ where: { accessKey } });
    if (!user) return null;
    const row = await prisma.apiKey.findFirst({
      where: { keyHash: this.hash(token), userId: user.id, revokedAt: null },
    });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return row as ApiKeyRow;
  }

  async revoke(id: string): Promise<void> {
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async list() {
    return prisma.apiKey.findMany({
      where: { revokedAt: null },
      select: {
        id: true,
        name: true,
        scopes: true,
        rateLimit: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        teamId: true,
        role: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
