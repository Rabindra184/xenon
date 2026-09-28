import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { PrismaClient } from '../../src/generated/client';
import { prisma } from '../../src/prisma';

const METHODS = [
  'findUnique',
  'findFirst',
  'findMany',
  'create',
  'update',
  'upsert',
  'delete',
  'deleteMany',
] as const;

export interface ScratchPortLeases {
  /** The scratch database's client, for reading the lease table directly. */
  db: PrismaClient;
  /** A random 100-port block in 40000-60000, fresh for each test. */
  base: number;
}

/**
 * Back `prisma.portLease` with a scratch SQLite file for the enclosing
 * `describe`, so PortAllocator runs its real queries (unique constraint on
 * `port` included) without touching the server's database.
 *
 * Call it inside a `describe`, never at the top of a file. The database is
 * created once per suite; the table is emptied and the stubs are re-made
 * before each test, so a spec's own `sinon.restore()` can't leave the next
 * test pointed at the real database.
 */
export function useScratchPortLeases(): ScratchPortLeases {
  const ctx = {} as ScratchPortLeases;
  const sandbox = sinon.createSandbox();
  let dbPath = '';

  before(function () {
    this.timeout(60_000);
    dbPath = path.join(os.tmpdir(), `xenon-port-leases-${process.pid}-${Date.now()}.db`);
    const url = `file:${dbPath}`;
    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    ctx.db = new PrismaClient({ datasources: { db: { url } } });
  });

  beforeEach(async () => {
    await ctx.db.portLease.deleteMany({});
    ctx.base = 40000 + Math.floor(Math.random() * 199) * 100;
    const wrapper = prisma.portLease as any;
    for (const m of METHODS) {
      sandbox.stub(wrapper, m).callsFake((...args: any[]) => (ctx.db.portLease as any)[m](...args));
    }
  });

  afterEach(() => sandbox.restore());

  after(async () => {
    sandbox.restore();
    if (ctx.db) await ctx.db.$disconnect();
    for (const f of [dbPath, `${dbPath}-journal`]) {
      if (f && fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  return ctx;
}
