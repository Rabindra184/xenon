import { expect } from 'chai';
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '../../src/generated/client';
import { config } from '../../src/config';
import sinon from 'sinon';
import { runMigrations, warnOfUnmigratedSchemaChanges } from '../../src/scripts/run-migrations';

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

/** Whether the database's tables are exactly what a schema (prisma/schema.prisma) says. */
function matchesSchema(file: string, schema = SCHEMA): boolean {
  try {
    prismaCli(
      [
        'migrate',
        'diff',
        '--from-url',
        `file:${file}`,
        '--to-schema-datamodel',
        schema,
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

// A selector fingerprint too, so a migration that changes LocatorEtalon meets a row.
const SEED = `
INSERT INTO "Team" ("id", "name", "createdAt") VALUES ('team-1', 'Payments', 1759600000000);
INSERT INTO "Build" ("id", "name", "createdAt", "updatedAt") VALUES ('build-1', 'nightly #42', 1759600000000, 1759600000000);
INSERT INTO "LocatorEtalon" ("id", "selector", "strategy", "attributes", "nodeName", "lastSeen", "createdAt", "updatedAt") VALUES ('et-1', '//b', 'xpath', '{}', 'Button', 1759600000000, 1759600000000, 1759600000000);
`;

async function seededRows(file: string): Promise<string[]> {
  const teams = await query<{ id: string; name: string }>(file, 'SELECT id, name FROM "Team"');
  const builds = await query<{ id: string; name: string }>(file, 'SELECT id, name FROM "Build"');
  const etalons = await query<{ id: string; name: string }>(
    file,
    'SELECT id, selector AS name FROM "LocatorEtalon"',
  );
  return [...teams, ...builds, ...etalons].map((r) => `${r.id}=${r.name}`).sort();
}

const SEEDED = ['build-1=nightly #42', 'et-1=//b', 'team-1=Payments'];

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

  /** Every local migration recorded as applied, none failed: what migrate deploy leaves. */
  async function expectFullHistory(file: string, migrations = LOCAL_MIGRATIONS): Promise<void> {
    const history = await recordedHistory(file);
    const applied = history.filter((r) => r.finished_at && !r.rolled_back_at);
    expect(applied.map((r) => r.migration_name).sort()).to.deep.equal(migrations);
    expect(history.filter((r) => !r.finished_at && !r.rolled_back_at)).to.deep.equal([]);
  }

  /** The copies a start tries the migrations on, which it must not leave behind. */
  function trialCopiesOf(file: string): string[] {
    const prefix = `${path.basename(file)}.xenon-trial-`;
    return fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(prefix));
  }

  // Re-baselining: db push writes no history, so these two stayed on db push
  // for good, and refused at the first release whose migration drops a column
  // or adds a unique index (see the next releases below). Now their history
  // records what the tables have, and migrate deploy takes over.
  it('records what the tables of a database ahead of its history have, and puts it back on migrate deploy', async () => {
    const file = copyOf(historyBehind);
    await start(file, 'postgresql');

    expect(matchesSchema(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
    await expectFullHistory(file);
    expect(trialCopiesOf(file)).to.deep.equal([]);
  });

  it('starts a database whose history records a failed migration, and clears it', async () => {
    const file = copyOf(historyFailed);
    await start(file, 'postgresql');

    expect(matchesSchema(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
    await expectFullHistory(file);
  });

  it('records a migration that was rolled back when the tables have it', async () => {
    const file = copyOf(historyFailed);
    prismaCli(
      ['migrate', 'resolve', '--rolled-back', LOCAL_MIGRATIONS[LOCAL_MIGRATIONS.length - 1]],
      file,
    );
    await start(file, 'sqlite');

    expect(matchesSchema(file)).to.equal(true);
    await expectFullHistory(file);
  });

  // A history database whose tables differ from its migrations for another
  // reason than db push: a table with a row and an index added by hand. `db
  // push --accept-data-loss` would drop them, and the default setting did.
  // `migrate deploy`, the old `postgresql` path, kept them; a start now tries
  // it on a copy and uses it when it works there. When it doesn't, db push
  // without the flag refuses to drop the table, and the start stops with
  // commands to paste. The cases that stop follow them as an operator would.
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

  /** Whether the tables are a schema's plus what was added by hand. */
  function matchesSchemaWithHandAdded(file: string, schema = SCHEMA): boolean {
    const probe = `${file}.probe`;
    fs.copyFileSync(file, probe);
    try {
      sql(probe, 'DROP TABLE IF EXISTS "LabNotes"; DROP INDEX IF EXISTS "lab_team_created";');
      return matchesSchema(probe, schema);
    } finally {
      fs.rmSync(probe, { force: true });
    }
  }

  async function failedMigrations(file: string): Promise<string[]> {
    const history = await recordedHistory(file);
    return history.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  }

  it('keeps what was added by hand to a history database: migrate deploy worked on a copy', async () => {
    const file = copyOf(withHistory);
    sql(file, HAND);

    await start(file, 'sqlite');
    expect(await handAdded(file)).to.deep.equal(KEPT);
    expect(matchesSchemaWithHandAdded(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
    await expectFullHistory(file);
    expect(trialCopiesOf(file), 'the copy is gone').to.deep.equal([]);

    await start(file, 'sqlite');
    expect(await handAdded(file)).to.deep.equal(KEPT);
  });

  // db push drops an index without asking, with or without the flag.
  it('keeps an index added by hand to a history database', async () => {
    const file = copyOf(withHistory);
    sql(file, 'CREATE INDEX "lab_team_created" ON "Team"("createdAt");');

    await start(file, 'sqlite');
    expect((await handAdded(file)).index).to.equal(true);
    await expectFullHistory(file);
  });

  // Tables ahead of the history and a table added by hand: no run of the
  // migrations matches the tables, and migrate deploy fails on the copy on
  // the change already there (P3018). The file never gets migrate deploy.
  it('never sends migrate deploy to a database whose tables are ahead of its history', async () => {
    const file = copyOf(historyBehind);
    sql(file, HAND);

    const message = await startStops(file);
    expect(message).to.match(/stopped rather than delete/);
    expect(message).to.match(/failed on a copy/);
    expect(message).to.include('LabNotes');
    expect(await failedMigrations(file), 'the file records no failed migration').to.deep.equal([]);
    expect(await handAdded(file)).to.deep.equal(KEPT);
    expect(trialCopiesOf(file)).to.deep.equal([]);

    const commands = commandsIn(message);
    expect(commands.filter((c) => c.includes('migrate deploy'))).to.deep.equal([]);
    const backup = commands.find((c) => c.includes('.backup-')) as string;
    const letGo = commands.find((c) => c.includes('--accept-data-loss')) as string;
    expect([backup, letGo].every(Boolean), message).to.equal(true);
    expect(letGo).to.equal(
      `DATABASE_URL=file:${file} ${PRISMA} db push --skip-generate --accept-data-loss --schema ${SCHEMA}`,
    );

    // Let it go, as it says, and start: the history then catches up.
    paste(backup);
    paste(letGo);
    await start(file, 'sqlite');
    expect(await handAdded(file)).to.deep.equal(GONE);
    expect(await handAdded(vacuumTarget(backup))).to.deep.equal(KEPT);
    expect(matchesSchema(file)).to.equal(true);
    expect(await seededRows(file)).to.deep.equal(SEEDED);
    await expectFullHistory(file);
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
    expect(await failedMigrations(file)).to.deep.equal([newest]);

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
    await expectFullHistory(file);
  });

  // A start that died while it tried the migrations on a copy left the copy.
  it('removes a copy a start that died left behind', async () => {
    const file = copyOf(withHistory);
    const leftover = `${file}.xenon-trial-999993`;
    fs.copyFileSync(file, leftover);
    fs.writeFileSync(`${leftover}-journal`, '');
    // Signal 0 only asks whether a process is there; stubbed all the same.
    const kill = sinon.stub(process, 'kill').callsFake((() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    }) as any);
    try {
      await start(file, 'sqlite');
    } finally {
      kill.restore();
    }
    expect(trialCopiesOf(file)).to.deep.equal([]);
  });

  // The two kinds of migration `db push` without --accept-data-loss refuses
  // on a table with rows: one that drops a column, one that adds a unique
  // index. Each is made as a release after this one would make it, with
  // Prisma's own migration for the change.
  describe('the next release', () => {
    /** A plugin root for a release after this one: this schema, edited, and its migration. */
    function nextRelease(name: string, edit: (schema: string) => string): string {
      const root = path.join(dir, `next-${name}`);
      fs.mkdirSync(path.join(root, 'prisma'), { recursive: true });
      fs.cpSync(MIGRATIONS, path.join(root, 'prisma', 'migrations'), { recursive: true });
      const before = fs.readFileSync(SCHEMA, 'utf8');
      const after = edit(before);
      expect(after, 'the edit changes the schema').to.not.equal(before);
      const schema = path.join(root, 'prisma', 'schema.prisma');
      fs.writeFileSync(schema, after);
      const script = execFileSync(
        PRISMA,
        [
          'migrate',
          'diff',
          '--from-schema-datamodel',
          SCHEMA,
          '--to-schema-datamodel',
          schema,
          '--script',
        ],
        { cwd: ROOT, env: { ...process.env, CHECKPOINT_DISABLE: '1' }, stdio: 'pipe' },
      ).toString();
      const migration = path.join(root, 'prisma', 'migrations', `29990101000000_${name}`);
      fs.mkdirSync(migration);
      fs.writeFileSync(path.join(migration, 'migration.sql'), script);
      fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));
      return root;
    }

    let dropColumn: string;
    let addUnique: string;
    /** This release's database with its full history, and a table and index added by hand. */
    let currentWithHand: string;

    before(async () => {
      dropColumn = nextRelease('drop_attributes', (schema) =>
        schema.replace(/(model LocatorEtalon \{[^}]*?)\n {2}attributes +String\n/, '$1\n'),
      );
      addUnique = nextRelease('unique_strategy_node', (schema) =>
        schema.replace(
          /(model LocatorEtalon \{[^}]*?)\n\}/,
          '$1\n\n  @@unique([strategy, nodeName])\n}',
        ),
      );
      currentWithHand = path.join(dir, 'current-with-hand.db');
      fs.copyFileSync(withHistory, currentWithHand);
      prismaCli(['migrate', 'deploy', '--schema', SCHEMA], currentWithHand);
      sql(currentWithHand, HAND);
    });

    async function startNext(file: string, root: string): Promise<void> {
      config.databaseUrl = `file:${file}`;
      config.databaseProvider = 'sqlite';
      await runMigrations(undefined, undefined, { root });
    }

    const migrationsOf = (root: string) =>
      fs
        .readdirSync(path.join(root, 'prisma', 'migrations'))
        .filter((n) => !n.endsWith('.toml'))
        .sort();

    for (const [label, rootOf] of [
      ['drops a column', () => dropColumn],
      ['adds a unique index', () => addUnique],
    ] as const) {
      describe(`that ${label}`, () => {
        it('updates a database ahead of its history with migrate deploy', async () => {
          const root = rootOf();
          const file = copyOf(historyBehind);
          await startNext(file, root);
          expect(matchesSchema(file, path.join(root, 'prisma', 'schema.prisma'))).to.equal(true);
          expect(await seededRows(file)).to.deep.equal(SEEDED);
          await expectFullHistory(file, migrationsOf(root));
        });

        it('updates a database with a failed migration recorded with migrate deploy', async () => {
          const root = rootOf();
          const file = copyOf(historyFailed);
          await startNext(file, root);
          expect(matchesSchema(file, path.join(root, 'prisma', 'schema.prisma'))).to.equal(true);
          expect(await seededRows(file)).to.deep.equal(SEEDED);
          await expectFullHistory(file, migrationsOf(root));
        });

        it('keeps what was added by hand to a database with its full history', async () => {
          const root = rootOf();
          const file = copyOf(currentWithHand);
          await startNext(file, root);
          expect(await handAdded(file)).to.deep.equal(KEPT);
          expect(
            matchesSchemaWithHandAdded(file, path.join(root, 'prisma', 'schema.prisma')),
          ).to.equal(true);
          expect(await seededRows(file)).to.deep.equal(SEEDED);
          await expectFullHistory(file, migrationsOf(root));
        });
      });
    }

    // Minor: `npm run db:migrate` warns of a schema edit with no migration.
    it('tells schema changes with no migration from a schema its migrations make', () => {
      const unmigrated = path.join(dir, 'unmigrated');
      fs.mkdirSync(path.join(unmigrated, 'prisma'), { recursive: true });
      fs.cpSync(MIGRATIONS, path.join(unmigrated, 'prisma', 'migrations'), { recursive: true });
      fs.copyFileSync(
        path.join(dropColumn, 'prisma', 'schema.prisma'),
        path.join(unmigrated, 'prisma', 'schema.prisma'),
      );
      fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(unmigrated, 'node_modules'));

      expect(warnOfUnmigratedSchemaChanges(undefined, { root: ROOT })).to.equal(false);
      expect(warnOfUnmigratedSchemaChanges(undefined, { root: dropColumn })).to.equal(false);
      expect(warnOfUnmigratedSchemaChanges(undefined, { root: unmigrated })).to.equal(true);
    });
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
