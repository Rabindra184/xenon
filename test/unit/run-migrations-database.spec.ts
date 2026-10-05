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
// Through 2.15.0 the step chose its command from `databaseProvider` alone:
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

  // Through 2.15.0 the setting chose the command, so these two run under both.
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

  // A history database whose tables differ from its migrations for another
  // reason than db push: a table and an index added by hand. `db push
  // --accept-data-loss` would drop them, rows and all, and the default setting
  // did. Without the flag, db push refuses, and the start says what to do.
  it('drops nothing that a history database has beyond its migrations, and says what to do', async () => {
    const file = copyOf(withHistory);
    sql(
      file,
      'CREATE TABLE "LabNotes" ("id" INTEGER PRIMARY KEY, "note" TEXT); ' +
        'INSERT INTO "LabNotes" ("note") VALUES (\'keep me\'); ' +
        'CREATE INDEX "lab_team_created" ON "Team"("createdAt");',
    );

    let error: Error | undefined;
    try {
      await start(file, 'sqlite');
    } catch (e: any) {
      error = e;
    }

    expect(error, 'the start stops rather than drop the table').to.be.an('Error');
    expect(error?.message).to.match(/would delete data/);
    expect(error?.message).to.include('LabNotes');
    const notes = await query<{ note: string }>(file, 'SELECT note FROM "LabNotes"');
    expect(notes.map((r) => r.note)).to.deep.equal(['keep me']);
    const index = await query<{ name: string }>(
      file,
      "SELECT name FROM sqlite_master WHERE name = 'lab_team_created'",
    );
    expect(index).to.have.length(1);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
    const history = await recordedHistory(file);
    expect(history).to.have.length(LOCAL_MIGRATIONS.length - 1);
    expect(history.every((r) => r.finished_at)).to.equal(true);
  });

  // Prisma resolves a relative SQLite URL against the schema's directory,
  // prisma/. Through the first cut of this change the history was read through
  // a client that couldn't open a file in a directory that wasn't there yet,
  // where the CLI makes it.
  it('creates a new database at a relative file: URL in a directory that is not there yet', async () => {
    const target = path.join(dir, 'relative', 'nested', 'xenon.db');
    const relative = path.relative(path.dirname(SCHEMA), target);
    expect(path.isAbsolute(relative)).to.equal(false);

    config.databaseUrl = `file:${relative}`;
    config.databaseProvider = 'sqlite';
    await runMigrations();

    expect(fs.existsSync(target), 'the database is where the URL points').to.equal(true);
    expect(matchesSchema(target)).to.equal(true);
  });

  // A `_prisma_migrations` table that isn't Prisma's (other columns) is no
  // migration history. The default setting started on such a database.
  it("starts a database whose _prisma_migrations table isn't Prisma's", async () => {
    const file = copyOf(withoutHistory);
    sql(file, 'CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY, "migration_name" TEXT);');

    await start(file, 'postgresql');

    expect(matchesSchema(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
  });

  // `npm run db:migrate` checks the URL as a start does, before reading anything.
  it('stops npm run db:migrate on a PostgreSQL URL with the database check, not a read error', () => {
    let output = '';
    let status: number | null = 0;
    try {
      output = execFileSync(
        path.join(ROOT, 'node_modules', '.bin', 'ts-node'),
        ['-T', path.join(ROOT, 'src', 'scripts', 'initialize-database.ts')],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            DATABASE_URL: 'postgresql://xenon:pw@127.0.0.1:1/xenon',
            XENON_DB_PROVIDER: '',
          },
          stdio: 'pipe',
        },
      ).toString();
    } catch (err: any) {
      status = err.status;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(status, output).to.not.equal(0);
    expect(output).to.match(/built for SQLite/);
    expect(output).to.not.match(/could not read/);
  });
});
