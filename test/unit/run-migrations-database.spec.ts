import { expect } from 'chai';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '../../src/generated/client';
import { config } from '../../src/config';
import { runMigrations } from '../../src/scripts/run-migrations';

// The startup schema step, run for real: the prisma CLI from node_modules
// against scratch SQLite files, never the server's own database.
//
// Through 2.14 the step chose its command from `databaseProvider` alone:
// `migrate deploy` for postgresql, `db push` for anything else. A database
// Xenon made with the default setting (or `npm run db:migrate`) has tables and
// no migration history, and `migrate deploy` refuses one of those (P3005), so a
// Xenon Control profile set to postgresql stopped the server. The default
// setting, in turn, ran `db push` on a database that keeps a migration history,
// moving its tables past that history, after which `migrate deploy` failed on
// the migration it had already applied (P3018) and recorded it as failed.
// The database now decides.

const ROOT = path.resolve(__dirname, '../..');
const PRISMA = path.join(ROOT, 'node_modules', '.bin', 'prisma');
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');
const MIGRATIONS = path.join(ROOT, 'prisma', 'migrations');

const LOCAL_MIGRATIONS = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => fs.existsSync(path.join(MIGRATIONS, name, 'migration.sql')))
  .sort();

function prismaCli(args: string[], file: string, input?: string): string {
  return execFileSync(PRISMA, args, {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `file:${file}`, CHECKPOINT_DISABLE: '1' },
    input,
    stdio: 'pipe',
  }).toString();
}

function sql(file: string, statements: string): void {
  prismaCli(['db', 'execute', '--url', `file:${file}`, '--stdin'], file, statements);
}

/** Whether the database's tables are exactly what prisma/schema.prisma says. */
function matchesSchema(file: string): boolean {
  try {
    prismaCli(
      [
        'migrate',
        'diff',
        '--from-url',
        `file:${file}`,
        '--to-schema-datamodel',
        SCHEMA,
        '--exit-code',
      ],
      file,
    );
    return true;
  } catch (err: any) {
    if (err?.status === 2) return false;
    throw err;
  }
}

async function query<T>(file: string, statement: string): Promise<T[]> {
  const client = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  try {
    return (await client.$queryRawUnsafe(statement)) as T[];
  } finally {
    await client.$disconnect();
  }
}

interface HistoryRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/** `_prisma_migrations`, or null when the database has none. */
async function historyOf(file: string): Promise<HistoryRow[] | null> {
  const [{ n }] = await query<{ n: bigint | number }>(
    file,
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'",
  );
  if (Number(n) === 0) return null;
  return query<HistoryRow>(
    file,
    'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"',
  );
}

/** `_prisma_migrations`, which the database must have. */
async function recordedHistory(file: string): Promise<HistoryRow[]> {
  const rows = await historyOf(file);
  if (!rows) throw new Error(`${file} has no migration history`);
  return rows;
}

const SEED = `
INSERT INTO "Team" ("id", "name", "createdAt") VALUES ('team-1', 'Payments', 1759600000000);
INSERT INTO "Build" ("id", "name", "createdAt", "updatedAt") VALUES ('build-1', 'nightly #42', 1759600000000, 1759600000000);
`;

async function seededRows(file: string): Promise<string[]> {
  const teams = await query<{ id: string; name: string }>(file, 'SELECT id, name FROM "Team"');
  const builds = await query<{ id: string; name: string }>(file, 'SELECT id, name FROM "Build"');
  return [...teams, ...builds].map((r) => `${r.id}=${r.name}`).sort();
}

const SEEDED = ['build-1=nightly #42', 'team-1=Payments'];

describe('runMigrations against real databases', function () {
  // Each start runs the prisma CLI two or three times.
  this.timeout(120000);

  let dir: string;
  let saved: Pick<typeof config, 'autoMigrate' | 'databaseProvider' | 'databaseUrl'>;
  /** The release before this one, with its migration history: what `migrate deploy` made. */
  let withHistory: string;
  /** The release before this one with no migration history: what `db push` made. */
  let withoutHistory: string;
  /** A history behind its tables: the default setting's `db push` ran on a `migrate deploy` database. */
  let historyBehind: string;
  /** A history that records a failed migration: `migrate deploy` ran on `historyBehind`. */
  let historyFailed: string;

  let copies = 0;
  function copyOf(fixture: string | null): string {
    const file = path.join(dir, `start-${++copies}.db`);
    if (fixture) fs.copyFileSync(fixture, file);
    return file;
  }

  async function start(file: string, provider: 'sqlite' | 'postgresql'): Promise<void> {
    config.databaseUrl = `file:${file}`;
    config.databaseProvider = provider;
    await runMigrations();
  }

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-run-migrations-'));

    // The previous release: every migration but the newest, so a start has one to apply.
    const previous = path.join(dir, 'previous');
    fs.mkdirSync(path.join(previous, 'migrations'), { recursive: true });
    fs.copyFileSync(SCHEMA, path.join(previous, 'schema.prisma'));
    fs.copyFileSync(
      path.join(MIGRATIONS, 'migration_lock.toml'),
      path.join(previous, 'migrations', 'migration_lock.toml'),
    );
    for (const name of LOCAL_MIGRATIONS.slice(0, -1)) {
      fs.mkdirSync(path.join(previous, 'migrations', name));
      fs.copyFileSync(
        path.join(MIGRATIONS, name, 'migration.sql'),
        path.join(previous, 'migrations', name, 'migration.sql'),
      );
    }

    withHistory = path.join(dir, 'with-history.db');
    prismaCli(['migrate', 'deploy', '--schema', path.join(previous, 'schema.prisma')], withHistory);

    withoutHistory = path.join(dir, 'without-history.db');
    fs.copyFileSync(withHistory, withoutHistory);
    sql(withoutHistory, 'DROP TABLE "_prisma_migrations";');

    sql(withHistory, SEED);
    sql(withoutHistory, SEED);

    historyBehind = path.join(dir, 'history-behind.db');
    fs.copyFileSync(withHistory, historyBehind);
    prismaCli(['db', 'push', '--skip-generate', '--schema', SCHEMA], historyBehind);

    historyFailed = path.join(dir, 'history-failed.db');
    fs.copyFileSync(historyBehind, historyFailed);
    try {
      prismaCli(['migrate', 'deploy', '--schema', SCHEMA], historyFailed);
    } catch {
      // P3018: the newest migration is already applied. That is the point.
    }
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    saved = {
      autoMigrate: config.autoMigrate,
      databaseProvider: config.databaseProvider,
      databaseUrl: config.databaseUrl,
    };
    config.autoMigrate = true;
  });

  afterEach(() => {
    Object.assign(config, saved);
  });

  it('builds the fixtures it means to', async () => {
    expect(LOCAL_MIGRATIONS.length).to.be.greaterThan(1);
    expect(await historyOf(withHistory)).to.have.length(LOCAL_MIGRATIONS.length - 1);
    expect(await historyOf(withoutHistory)).to.equal(null);
    expect(matchesSchema(withoutHistory), 'one migration left to apply').to.equal(false);
    expect(matchesSchema(historyBehind)).to.equal(true);
    const failed = (await recordedHistory(historyFailed)).filter((r) => !r.finished_at);
    expect(failed.map((r) => r.migration_name)).to.deep.equal([
      LOCAL_MIGRATIONS[LOCAL_MIGRATIONS.length - 1],
    ]);
  });

  // Through 2.14 the setting chose the command, so these two run under both.
  for (const provider of ['sqlite', 'postgresql'] as const) {
    describe(`with databaseProvider ${provider}`, () => {
      it('brings a database kept with db push up to date, keeps its rows, and keeps it on db push', async () => {
        const file = copyOf(withoutHistory);
        await start(file, provider);

        expect(matchesSchema(file)).to.equal(true);
        expect(await seededRows(file)).to.deep.equal(SEEDED);
        expect(await historyOf(file), 'no migration history was made up').to.equal(null);

        await start(file, provider);
        expect(matchesSchema(file)).to.equal(true);
        expect(await seededRows(file)).to.deep.equal(SEEDED);
      });

      it('applies the missing migration to a database with migration history, and records it', async () => {
        const file = copyOf(withHistory);
        await start(file, provider);

        expect(matchesSchema(file)).to.equal(true);
        expect(await seededRows(file)).to.deep.equal(SEEDED);
        const history = await recordedHistory(file);
        expect(history.map((r) => r.migration_name).sort()).to.deep.equal(LOCAL_MIGRATIONS);
        expect(history.every((r) => r.finished_at && !r.rolled_back_at)).to.equal(true);

        await start(file, provider);
        expect(await recordedHistory(file)).to.have.length(LOCAL_MIGRATIONS.length);
        expect(await seededRows(file)).to.deep.equal(SEEDED);
      });
    });
  }

  // The rest ran into trouble under postgresql, the setting that chose migrate deploy.
  it('creates a new database', async () => {
    const file = copyOf(null);
    await start(file, 'postgresql');
    expect(matchesSchema(file)).to.equal(true);

    await start(file, 'postgresql');
    expect(matchesSchema(file)).to.equal(true);
  });

  it('starts a database whose tables are ahead of its history, without recording a failed migration', async () => {
    const file = copyOf(historyBehind);
    await start(file, 'postgresql');

    expect(matchesSchema(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
    const history = await recordedHistory(file);
    expect(history.filter((r) => !r.finished_at && !r.rolled_back_at)).to.deep.equal([]);
  });

  it('starts a database whose history records a failed migration', async () => {
    const file = copyOf(historyFailed);
    await start(file, 'postgresql');

    expect(matchesSchema(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
  });
});
