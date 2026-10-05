import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { PrismaClient } from '../../src/generated/client';
import { prisma } from '../../src/prisma';

// Every model the `prisma` wrapper exposes (src/prisma.ts MODEL_DELEGATES).
const MODELS = [
  'build',
  'session',
  'sessionLog',
  'log',
  'profiling',
  'app',
  'device',
  'deviceSetting',
  'pendingSession',
  'cLIArgs',
  'webhookConfig',
  'webConfig',
  'locatorEtalon',
  'lease',
  'portLease',
  'apiKey',
  'selectorState',
  'user',
  'userSession',
  'passwordResetToken',
  'team',
  'teamMember',
  'eventLog',
  'project',
  'recording',
  'bookmark',
  'annotation',
  'sessionMetric',
  'selectorEvent',
] as const;

let scratchCount = 0;
let template: string | undefined;

/**
 * A database migrated once for the whole process, which each suite copies.
 * Removed when the process exits.
 */
function migratedTemplate(): string {
  if (template) return template;
  const file = path.join(os.tmpdir(), `xenon-scratch-template-${process.pid}-${Date.now()}.db`);
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: `file:${file}` },
    stdio: 'pipe',
  });
  process.once('exit', () => {
    for (const f of [file, `${file}-journal`]) {
      try {
        fs.unlinkSync(f);
      } catch {
        // already gone
      }
    }
  });
  template = file;
  return file;
}

export interface ScratchDatabase {
  /** The scratch database's own client, for seeding and reading rows. */
  db: PrismaClient;
  /** Every SQL statement run since the test began, with its parameters, when asked for. */
  queries: Array<{ query: string; params: string }>;
}

/**
 * Back the whole `prisma` wrapper with a scratch SQLite file for the enclosing
 * `describe`, so the real queries (the device store, the session lifecycle,
 * SessionOwnerResolver) run against a real database that is not the server's.
 * Like useScratchPortLeases, for every model.
 *
 * Call it inside a `describe`, never at the top of a file. Each suite gets a
 * fresh database: a copy of one migrated once per process (migrating takes
 * seconds). The stubs are made before each test and removed after it, so a
 * spec's own `sinon.restore()` can't leave the next test on the real
 * database. Tests empty the tables they use.
 *
 * With `wholeSuite`, the stubs are made once, before the suite's own `before`
 * hooks (call it first in the describe), and removed after the suite. Making
 * them takes tens of milliseconds, which a suite of hundreds of short tests
 * otherwise pays per test. Its `before` hooks can then seed the rows every
 * test reads, and nothing needs deleting: the file goes with the suite. Only
 * for a suite that doesn't stub or restore `prisma` itself. Its own `after`
 * hooks run once the stubs are gone, so they must not touch `prisma`: it is
 * the real database again by then.
 *
 * With `captureQueries`, `queries` holds the SQL each test ran, so a spec can
 * ask SQLite how it reads a table (`EXPLAIN QUERY PLAN`).
 */
export function useScratchDatabase(
  options: { captureQueries?: boolean; wholeSuite?: boolean } = {},
): ScratchDatabase {
  const ctx = { queries: [] } as unknown as ScratchDatabase;
  const sandbox = sinon.createSandbox();
  let dbPath = '';

  before(function () {
    this.timeout(90_000);
    scratchCount += 1;
    dbPath = path.join(
      os.tmpdir(),
      `xenon-scratch-${process.pid}-${Date.now()}-${scratchCount}.db`,
    );
    fs.copyFileSync(migratedTemplate(), dbPath);
    const url = `file:${dbPath}`;
    if (options.captureQueries) {
      const db = new PrismaClient({
        datasources: { db: { url } },
        log: [{ emit: 'event', level: 'query' }],
      });
      db.$on('query', (e) => ctx.queries.push({ query: e.query, params: e.params }));
      ctx.db = db as unknown as PrismaClient;
    } else {
      ctx.db = new PrismaClient({ datasources: { db: { url } } });
    }
    if (options.wholeSuite) stubPrisma();
  });

  function stubPrisma() {
    for (const model of MODELS) {
      const wrapper = (prisma as any)[model] as Record<string, unknown>;
      const delegate = (ctx.db as any)[model];
      for (const [name, value] of Object.entries(wrapper)) {
        if (typeof value !== 'function' || typeof delegate[name] !== 'function') continue;
        sandbox.stub(wrapper, name).callsFake((...args: unknown[]) => delegate[name](...args));
      }
    }
  }

  beforeEach(() => {
    ctx.queries.length = 0;
    if (!options.wholeSuite) stubPrisma();
  });

  afterEach(() => {
    if (!options.wholeSuite) sandbox.restore();
  });

  after(async () => {
    sandbox.restore();
    if (ctx.db) await ctx.db.$disconnect();
    for (const f of [dbPath, `${dbPath}-journal`]) {
      if (f && fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  return ctx;
}
