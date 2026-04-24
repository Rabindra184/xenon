import { Service } from 'typedi';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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
  teamId?: string | null;
  role?: string;
}

@Service()
export class ApiKeyService {
  private log = log.scope('ApiKey');

  hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  generateRaw(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async bootstrapIfEmpty(keyFilePath: string): Promise<string | null> {
    const count = await prisma.apiKey.count();
    if (count > 0) return null;

    const raw = this.generateRaw();
    const keyHash = this.hash(raw);

    fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
    fs.writeFileSync(keyFilePath, raw + '\n', { mode: 0o600 });

    await prisma.apiKey.create({
      data: {
        name: 'bootstrap',
        keyHash,
        scopes: 'admin',
        rateLimit: 300,
      },
    });

    this.log.warn(
      `No API keys found. Bootstrap key written to ${keyFilePath}. Rotate within 24h via POST /xenon/api/apikeys.`,
    );
    return raw;
  }

  async verify(raw: string | undefined): Promise<ApiKeyRow | null> {
    if (!raw) return null;
    const row = await prisma.apiKey.findUnique({ where: { keyHash: this.hash(raw) } });
    if (!row || row.revokedAt) return null;
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
  }): Promise<{ id: string; raw: string }> {
    const raw = this.generateRaw();
    const row = await prisma.apiKey.create({
      data: {
        name: params.name,
        keyHash: this.hash(raw),
        scopes: params.scopes.join(','),
        rateLimit: params.rateLimit ?? 300,
        teamId: params.teamId ?? null,
      },
    });
    return { id: row.id, raw };
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
        teamId: true,
        role: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
