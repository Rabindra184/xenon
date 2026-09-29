import { execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
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
  /**
   * A random 100-port block in 20000-32799, fresh for each test, whose ports
   * the specs use (base+0..9 and base+50..59) had no listener when picked.
   */
  base: number;
}

/**
 * Below every OS's ephemeral range (macOS 49152-65535, Linux 32768-60999).
 * The blocks used to come from 40000-60000, half of it inside macOS's range,
 * where the suite's own outgoing connections take ports: now and then one
 * held base+1 while a two-port range needed it, and PortAllocator answered
 * "range exhausted" in the full run only.
 */
const FIRST_BASE = 20000;
const BLOCKS = 128;
const USED_OFFSETS = [...Array(10).keys(), ...Array.from({ length: 10 }, (_, i) => 50 + i)];

function bindable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) =>
      // A host without IPv6 can't have a listener there either.
      resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT'),
    );
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function blockIsFree(base: number): Promise<boolean> {
  for (const offset of USED_OFFSETS) {
    if (!(await bindable(base + offset, '0.0.0.0'))) return false;
    if (!(await bindable(base + offset, '::'))) return false;
  }
  return true;
}

async function freeBlock(): Promise<number> {
  let base = FIRST_BASE;
  for (let attempt = 0; attempt < 20; attempt++) {
    base = FIRST_BASE + Math.floor(Math.random() * BLOCKS) * 100;
    if (await blockIsFree(base)) return base;
  }
  return base;
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
    ctx.base = await freeBlock();
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
