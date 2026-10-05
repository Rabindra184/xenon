import { expect } from 'chai';
import { execFileSync, execSync } from 'child_process';
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
  // reason than db push: a table with a row and an index added by hand. `db
  // push --accept-data-loss` would drop them, and the default setting did.
  // Without the flag, db push refuses to drop the table, and the start stops
  // with commands to paste. Each case below follows them as an operator would.
  const HAND =
    'CREATE TABLE "LabNotes" ("id" INTEGER PRIMARY KEY, "note" TEXT); ' +
    'INSERT INTO "LabNotes" ("note") VALUES (\'keep me\'); ' +
    'CREATE INDEX "lab_team_created" ON "Team"("createdAt");';

  async function startStops(file: string): Promise<string> {
    try {
      await start(file, 'sqlite');
    } catch (e: any) {
      return e.message;
    }
    throw new Error('the start was meant to stop');
  }

  /** The commands a failure message gives, one to an indented line, in its order. */
  function commandsIn(message: string): string[] {
    return message
      .split('\n')
      .filter((line) => /^ {2}(DATABASE_URL=|echo )/.test(line))
      .map((line) => line.trim());
  }

  /** Runs a command from a message as an operator would paste it into a shell. */
  function paste(command: string): string {
    return execSync(command, {
      shell: '/bin/sh',
      stdio: 'pipe',
      env: { ...process.env, CHECKPOINT_DISABLE: '1' },
    }).toString();
  }

  /** The file a `VACUUM INTO '<file>'` command writes. */
  function vacuumTarget(command: string): string {
    const match = /VACUUM INTO '([^']+)'/.exec(command);
    if (!match) throw new Error(`not a copy: ${command}`);
    return match[1];
  }

  async function handAdded(file: string): Promise<{ notes: string[]; index: boolean }> {
    const [{ n }] = await query<{ n: bigint | number }>(
      file,
      "SELECT count(*) AS n FROM sqlite_master WHERE name = 'LabNotes'",
    );
    const notes =
      Number(n) === 0
        ? []
        : (await query<{ note: string }>(file, 'SELECT note FROM "LabNotes"')).map((r) => r.note);
    const index = await query<{ name: string }>(
      file,
      "SELECT name FROM sqlite_master WHERE name = 'lab_team_created'",
    );
    return { notes, index: index.length === 1 };
  }

  const KEPT = { notes: ['keep me'], index: true };
  const GONE = { notes: [], index: false };

  /** Whether the tables are this version's schema plus what was added by hand. */
  function matchesSchemaWithHandAdded(file: string): boolean {
    const probe = `${file}.probe`;
    fs.copyFileSync(file, probe);
    try {
      sql(probe, 'DROP TABLE "LabNotes"; DROP INDEX "lab_team_created";');
      return matchesSchema(probe);
    } finally {
      fs.rmSync(probe, { force: true });
    }
  }

  async function failedMigrations(file: string): Promise<string[]> {
    const history = await recordedHistory(file);
    return history.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  }

  it('drops nothing added by hand to a history database, and its copy-first advice keeps it', async () => {
    const file = copyOf(withHistory);
    sql(file, HAND);

    const message = await startStops(file);
    expect(message).to.match(/stopped rather than delete/);
    expect(message).to.include('LabNotes');
    expect(await handAdded(file)).to.deep.equal(KEPT);
    expect(await recordedHistory(file)).to.have.length(LOCAL_MIGRATIONS.length - 1);

    // Back up, copy, deploy on the copy, then on the file, as it says.
    const commands = commandsIn(message);
    const backup = commands.find((c) => c.includes('.backup-')) as string;
    const copy = commands.find((c) => c.includes('VACUUM INTO') && c !== backup) as string;
    const copyUrl = `file:${vacuumTarget(copy)}`;
    const onCopy = commands.find((c) => c.startsWith(`DATABASE_URL=${copyUrl} `)) as string;
    const onFile = commands.find(
      (c) => c.startsWith(`DATABASE_URL=file:${file} `) && c.includes('migrate deploy'),
    ) as string;
    expect([backup, copy, onCopy, onFile].every(Boolean), message).to.equal(true);
    paste(backup);
    paste(copy);
    paste(onCopy);
    paste(onFile);
    fs.rmSync(vacuumTarget(copy));

    await start(file, 'sqlite');
    expect(await handAdded(file)).to.deep.equal(KEPT);
    expect(await handAdded(vacuumTarget(backup))).to.deep.equal(KEPT);
    expect(matchesSchemaWithHandAdded(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
    expect(await recordedHistory(file)).to.have.length(LOCAL_MIGRATIONS.length);
  });

  // Tables ahead of the history and a table added by hand: migrate deploy
  // fails on the change already there (P3018) and records it as failed, so
  // the advice tries it on a copy, which fails there and leaves the file be.
  it('never sends migrate deploy to a database whose tables are ahead of its history', async () => {
    const file = copyOf(historyBehind);
    sql(file, HAND);

    const message = await startStops(file);
    expect(message).to.match(/stopped rather than delete/);
    expect(message).to.include('LabNotes');

    const commands = commandsIn(message);
    const backup = commands.find((c) => c.includes('.backup-')) as string;
    const copy = commands.find((c) => c.includes('VACUUM INTO') && c !== backup) as string;
    const copyUrl = `file:${vacuumTarget(copy)}`;
    const onCopy = commands.find((c) => c.startsWith(`DATABASE_URL=${copyUrl} `)) as string;
    const letGo = commands.find((c) => c.includes('--accept-data-loss')) as string;
    expect([backup, copy, onCopy, letGo].every(Boolean), message).to.equal(true);
    expect(letGo).to.equal(
      `DATABASE_URL=file:${file} ${PRISMA} db push --skip-generate --accept-data-loss --schema ${SCHEMA}`,
    );

    paste(backup);
    paste(copy);
    expect(() => paste(onCopy)).to.throw(/P3018/);
    fs.rmSync(vacuumTarget(copy));
    expect(await failedMigrations(file), 'the file records no failed migration').to.deep.equal([]);

    // Let it go, as the message says when the copy fails.
    paste(letGo);
    await start(file, 'sqlite');
    expect(await handAdded(file)).to.deep.equal(GONE);
    expect(await handAdded(vacuumTarget(backup))).to.deep.equal(KEPT);
    expect(matchesSchema(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
  });

  // A failed migration recorded: migrate deploy stops at once (P3009).
  it('never suggests migrate deploy for a history that records a failed migration', async () => {
    const file = copyOf(historyFailed);
    sql(file, HAND);
    const newest = LOCAL_MIGRATIONS[LOCAL_MIGRATIONS.length - 1];

    const message = await startStops(file);
    expect(message).to.match(/stopped rather than delete/);
    expect(message).to.include(newest);
    expect(message).to.include('LabNotes');

    const commands = commandsIn(message);
    expect(commands.filter((c) => c.includes('migrate deploy'))).to.deep.equal([]);
    const backup = commands.find((c) => c.includes('.backup-')) as string;
    const letGo = commands.find((c) => c.includes('--accept-data-loss')) as string;
    expect([backup, letGo].every(Boolean), message).to.equal(true);

    paste(backup);
    paste(letGo);
    await start(file, 'sqlite');
    expect(await handAdded(file)).to.deep.equal(GONE);
    expect(await handAdded(vacuumTarget(backup))).to.deep.equal(KEPT);
    expect(matchesSchema(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
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
