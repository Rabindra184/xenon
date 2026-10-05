import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import log from '../logger';
import { config } from '../config';
import { describeDatabaseUrl } from './database-check';

/**
 * Bringing the database's schema up to date at startup.
 *
 * Two prisma commands can do it, and the database itself says which is right:
 *
 * - `prisma migrate deploy` applies the migrations that the database's history
 *   (the `_prisma_migrations` table) doesn't record. It refuses a database
 *   that has tables and no history (P3005). It fails on a migration whose
 *   change is already there (P3018), records that migration as failed, and
 *   then refuses to run again until someone resolves it (P3009).
 * - `prisma db push` makes the tables match prisma/schema.prisma and writes no
 *   history.
 *
 * So a database whose history is true to its tables gets `migrate deploy`.
 * Every other database gets `db push`, as the default setting always did: a
 * new one, one that `db push` made (the default, `npm run db:migrate`), one
 * whose tables differ from what its recorded migrations make, and one whose
 * history records a failed migration. A database that `db push` has updated
 * stays on `db push`. `databaseProvider` plays no part.
 *
 * `--accept-data-loss` goes only to a database with no history, as it always
 * did there. On a database with a history, the tables that differ from its
 * migrations may be ones somebody added by hand, or the half-finished copy a
 * failed migration left, holding the only copy of its rows: `db push` without
 * the flag refuses to drop a table or column that holds data, and the start
 * stops with the commands to run (`schemaSyncFailure`). It still drops an
 * index, an empty table or an empty column without asking.
 *
 * Through 2.15.0 `databaseProvider` chose. `postgresql` meant `migrate deploy`,
 * which stopped the server on every database the default had made (P3005).
 * The default meant `db push`, which moved a `migrate deploy` database's
 * tables past its history, so `migrate deploy` later failed on it (P3018).
 */

export type SchemaSyncCommand = 'db push' | 'migrate deploy';

/** What a database's `_prisma_migrations` table records. */
export interface MigrationHistory {
  /** Migrations that finished and weren't rolled back. */
  applied: string[];
  /** Migrations that started and never finished or were rolled back: `migrate deploy` stops on these (P3009). */
  failed: string[];
}

/** Reads a database's migration history: null when it has none. */
export type HistoryReader = (databaseUrl: string) => Promise<MigrationHistory | null>;

/** Why a plan chose its command. A failure's message depends on it. */
export type SchemaSyncBasis =
  /** No `_prisma_migrations`: `db push --accept-data-loss`. */
  | 'no-history'
  /** Every migration recorded: `migrate deploy`, which has nothing to do. */
  | 'complete'
  /** The tables are what the recorded migrations make: `migrate deploy` the rest. */
  | 'behind'
  /** The tables couldn't be compared: `migrate deploy`, as the history says. */
  | 'uncompared'
  /** The tables differ from what the recorded migrations make: `db push`. */
  | 'tables-differ'
  /** A failed migration recorded, which `migrate deploy` won't run past (P3009): `db push`. */
  | 'failed-migration';

export interface SchemaSyncPlan {
  command: SchemaSyncCommand;
  /** `db push --accept-data-loss`: only for a database with no history, as the default always did. */
  acceptDataLoss: boolean;
  /** Why this command, for the log. */
  reason: string;
  basis: SchemaSyncBasis;
  /** The failed migrations the history records. */
  failed: string[];
}

/**
 * Which command brings a database up to date. `historyMatchesTables` is asked
 * only about a database with migrations left to apply. Given the applied
 * migrations, it says whether the tables are what they make, or null when it
 * can't tell.
 */
export function planSchemaSync(
  history: MigrationHistory | null,
  localMigrations: string[],
  historyMatchesTables: (applied: string[]) => boolean | null,
): SchemaSyncPlan {
  if (!history) {
    return {
      command: 'db push',
      acceptDataLoss: true,
      reason: 'it has no migration history (a new database, or one kept up to date with db push)',
      basis: 'no-history',
      failed: [],
    };
  }
  if (history.failed.length > 0) {
    return {
      command: 'db push',
      acceptDataLoss: false,
      reason:
        `its migration history records a failed migration (${history.failed.join(', ')}), ` +
        'which migrate deploy will not get past',
      basis: 'failed-migration',
      failed: history.failed,
    };
  }
  const applied = new Set(history.applied);
  const pending = localMigrations.filter((name) => !applied.has(name));
  if (pending.length === 0) {
    return {
      command: 'migrate deploy',
      acceptDataLoss: false,
      reason: 'its migration history has every migration',
      basis: 'complete',
      failed: [],
    };
  }
  const matches = historyMatchesTables(localMigrations.filter((name) => applied.has(name)));
  if (matches === false) {
    return {
      command: 'db push',
      acceptDataLoss: false,
      reason:
        'its tables differ from what its recorded migrations make (db push updated it, or it ' +
        'was changed by hand), so migrate deploy could fail on a change that is already there',
      basis: 'tables-differ',
      failed: [],
    };
  }
  return {
    command: 'migrate deploy',
    acceptDataLoss: false,
    reason:
      `its migration history is missing ${pending.length} migration(s)` +
      (matches === null ? ' (the tables could not be compared with the history)' : ''),
    basis: matches === null ? 'uncompared' : 'behind',
    failed: [],
  };
}

/**
 * The file a SQLite `file:` URL names, or null for anything else. Prisma reads
 * a relative path from the schema's directory, so that is `baseDir`; without
 * one, a relative path gives null.
 */
function sqliteFilePath(databaseUrl: string, baseDir?: string): string | null {
  if (!databaseUrl.startsWith('file:')) return null;
  const file = databaseUrl.slice('file:'.length).split('?')[0];
  if (path.isAbsolute(file)) return file;
  return baseDir ? path.resolve(baseDir, file) : null;
}

interface HistoryRow {
  migration_name: string;
  finished_at: unknown;
  rolled_back_at: unknown;
}

/** The migration history in `_prisma_migrations`, or null when the database has none. */
export async function readMigrationHistory(databaseUrl: string): Promise<MigrationHistory | null> {
  const file = sqliteFilePath(databaseUrl);
  if (file && !fs.existsSync(file)) return null;

  const { PrismaClient } = await import('../generated/client');
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rows = await client.$queryRawUnsafe<HistoryRow[]>(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    return {
      applied: rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
      failed: rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
    };
  } catch (err: any) {
    const message = String(err?.meta?.message ?? err?.message ?? err);
    if (/no such table|relation .* does not exist/i.test(message)) return null;
    if (/no such column|column .* does not exist/i.test(message)) {
      // A table of that name that isn't Prisma's. The default setting always
      // started on such a database, with db push, which leaves the table alone.
      log.warn(
        "[DBMigrate] The database's _prisma_migrations table is not Prisma's migration " +
          `history (${message}), so Xenon treats the database as having none.`,
      );
      return null;
    }
    throw err;
  } finally {
    await client.$disconnect();
  }
}

/** The migrations in prisma/migrations, in the order Prisma applies them. */
function localMigrationsIn(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => fs.existsSync(path.join(migrationsDir, name, 'migration.sql')))
    .sort();
}

/** Where a failure's commands point: this server's prisma CLI, schema and database. */
export interface PrismaCommandLine {
  /** The prisma CLI as a shell runs it. */
  prisma: string;
  schema: string;
  /** The database's URL, a SQLite file's with its absolute path. */
  databaseUrl: string;
  /** The SQLite file, or null for a URL that isn't one. */
  file: string | null;
}

/** A word a POSIX shell reads as itself: quoted only when it has to be. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * The commands a failure's message gives, ready to paste. A copy is made with
 * SQLite's `VACUUM INTO` through `prisma db execute`, so it is consistent
 * whatever journal sits beside the file, and needs nothing but the CLI.
 */
function pasteable(at: PrismaCommandLine) {
  const schema = shellWord(at.schema);
  const url = (file: string) => `file:${file}`;
  return {
    copyTo(target: string): string {
      const statement = `VACUUM INTO '${target.replace(/'/g, "''")}'`;
      const quoted = /["$`\\!]/.test(statement) ? shellWord(statement) : `"${statement}"`;
      return `echo ${quoted} | ${at.prisma} db execute --url ${shellWord(at.databaseUrl)} --stdin`;
    },
    deploy(file: string): string {
      return `DATABASE_URL=${shellWord(url(file))} ${at.prisma} migrate deploy --schema ${schema}`;
    },
    letGo(): string {
      return (
        `DATABASE_URL=${shellWord(at.databaseUrl)} ${at.prisma} db push --skip-generate ` +
        `--accept-data-loss --schema ${schema}`
      );
    },
  };
}

/** A backup's name: the file's, stamped with the time, so one never overwrites another. */
function backupOf(file: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return `${file}.backup-${stamp}`;
}

/** The migration a P3018 names, if it does. */
function failedMigrationIn(output: string): string | null {
  const match = /Migration name:\s*(\S+)/.exec(output);
  return match ? match[1] : null;
}

/**
 * What went wrong and what to do, then Prisma's own output. A refusal to
 * delete data gives the commands to run, with this server's paths, and never
 * sends `migrate deploy` to a database it would fail on: one with a failed
 * migration recorded (P3009), or one whose tables are ahead of its history
 * (P3018, which records the migration as failed).
 */
export function schemaSyncFailure(
  plan: SchemaSyncPlan,
  output: string,
  at: PrismaCommandLine,
  now: Date = new Date(),
): string {
  const where = describeDatabaseUrl(at.databaseUrl);
  const run = pasteable(at);
  let sentence: string;
  if (/Added the required column/i.test(output)) {
    sentence =
      `This version adds a required column to a table that already has rows in ${where}, ` +
      'which prisma db push cannot do: back the file up, then migrate it by hand or start ' +
      'from a fresh database.';
  } else if (/accept-data-loss|There might be data loss/i.test(output)) {
    const why =
      plan.basis === 'failed-migration'
        ? `its migration history records a failed migration (${plan.failed.join(', ')}), ` +
          "which prisma migrate deploy won't run past"
        : 'its tables differ from what its recorded migrations make (something was added to ' +
          'them by hand, or prisma db push moved them past the history)';
    const backup = at.file
      ? `Back the file up first:\n  ${run.copyTo(backupOf(at.file, now))}\n`
      : 'Back the database up first. ';
    sentence =
      'prisma db push stopped rather than delete what Prisma lists below from the database ' +
      `at ${where}. Xenon brings this database up to date with prisma db push because ${why}, ` +
      'and without --accept-data-loss db push deletes no table or column that holds data. ' +
      backup +
      `To let what is listed go, run this and start again:\n  ${run.letGo()}\n`;
    if (plan.basis === 'failed-migration' || !at.file) {
      sentence += 'To keep any of it, copy it out of the database first.';
    } else {
      // migrate deploy works on the file only if the tables are not ahead of
      // its history, which nothing here can tell: a copy finds out.
      const copy = `${at.file}.copy`;
      sentence +=
        "To keep it, try this version's migrations on a copy of the file instead:\n" +
        `  ${run.copyTo(copy)}\n` +
        `  ${run.deploy(copy)}\n` +
        'If that works, run them on the file, delete the copy and start again:\n' +
        `  ${run.deploy(at.file)}\n` +
        'If it fails, they would fail on the file too (P3018 means the tables already have ' +
        "a change the history doesn't record): delete the copy, copy out anything you need, " +
        'and let what is listed go as above.';
    }
  } else if (/P3018/.test(output)) {
    const name = failedMigrationIn(output);
    sentence =
      `A migration${name ? `, ${name},` : ''} failed on the database at ${where}, and its ` +
      "migration history now records it as failed. Check Prisma's reason below. If what the " +
      'migration makes is already there ("already exists", "duplicate column name"), start ' +
      'again: Xenon brings a database with a failed migration recorded up to date with ' +
      'prisma db push, which stops before deleting a table or column that holds data. If ' +
      'the migration failed on the rows in the database (a unique index over duplicate ' +
      'values, say), back the file up, change those rows, and start again.';
  } else {
    sentence =
      `prisma ${plan.command} could not bring the database at ${where} up to date: back the ` +
      'file up and fix what Prisma reports below, or, if its schema already matches this ' +
      'version, set XENON_AUTO_MIGRATE=false to start without changing it.';
  }
  return `[DBMigrate] Cannot start: ${sentence}\n\n${output}`;
}

/** What a failed prisma call printed: its warnings (stdout) and its error (stderr). */
function cliOutput(err: any): string {
  const parts = [err?.stdout, err?.stderr].map((b) => (b ? b.toString().trim() : ''));
  return parts.filter(Boolean).join('\n') || String(err?.message ?? err).trim();
}

function resolvePluginRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const pkgJson = path.join(dir, 'package.json');
    const schema = path.join(dir, 'prisma', 'schema.prisma');
    if (fs.existsSync(pkgJson) && fs.existsSync(schema)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
        if (pkg.name === '@xenon-device-management/xenon' || pkg.name === 'xenon') {
          return dir;
        }
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '../../..');
}

function resolvePrismaInvocation(rootDir: string): { cmd: string; prefix: string[] } {
  const localBin = path.resolve(rootDir, 'node_modules/.bin/prisma');
  if (fs.existsSync(localBin)) return { cmd: localBin, prefix: [] };
  return { cmd: 'npx', prefix: ['prisma'] };
}

/**
 * Runs the prisma CLI. Injectable so tests can drive the failure path without
 * shelling out — `node:child_process` exports are non-configurable, so they
 * can't be stubbed in place.
 */
export type SchemaSyncRunner = (
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; stdio: 'pipe' },
) => unknown;

/**
 * Bring the database at `config.databaseUrl` up to date with prisma/schema.prisma,
 * by the rule above. Throws an Error whose message says what to do when it can't.
 * `npm run db:migrate` runs this too, whatever XENON_AUTO_MIGRATE says.
 */
export async function syncDatabaseSchema(
  runSync: SchemaSyncRunner = execFileSync as SchemaSyncRunner,
  readHistory: HistoryReader = readMigrationHistory,
): Promise<void> {
  const rootDir = resolvePluginRoot();
  const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
  const migrationsDir = path.join(rootDir, 'prisma', 'migrations');

  if (!fs.existsSync(schemaPath) || !fs.existsSync(migrationsDir)) {
    log.warn(`[DBMigrate] Skipping auto-migrate: schema or migrations missing at ${rootDir}`);
    return;
  }

  const databaseUrl = config.databaseUrl;
  const where = describeDatabaseUrl(databaseUrl);
  // The file the CLI will use: a relative path is read from prisma/, as Prisma does.
  const file = sqliteFilePath(databaseUrl, path.dirname(schemaPath));
  fs.mkdirSync(path.dirname(file ?? config.databasePath), { recursive: true });

  const { cmd, prefix } = resolvePrismaInvocation(rootDir);
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const opts = { env, cwd: rootDir, stdio: 'pipe' as const };

  let history: MigrationHistory | null;
  try {
    history = await readHistory(file ? `file:${file}` : databaseUrl);
  } catch (err: any) {
    throw new Error(
      '[DBMigrate] Cannot start: Xenon could not read the migration history of the database ' +
        `at ${where}, so it can't tell how to bring it up to date: if another server is using ` +
        'the file, stop that one; otherwise back the file up, check that it is a Xenon SQLite ' +
        `database (Prisma's message is below), and start again.\n\n${err?.message ?? err}`,
    );
  }

  // Would the history's own migrations make exactly these tables? Built from
  // this release's copies of the applied migrations, in a scratch directory.
  const historyMatchesTables = (applied: string[]): boolean | null => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-migration-history-'));
    try {
      const lock = path.join(migrationsDir, 'migration_lock.toml');
      if (fs.existsSync(lock)) fs.copyFileSync(lock, path.join(scratch, 'migration_lock.toml'));
      for (const name of applied) {
        fs.mkdirSync(path.join(scratch, name));
        fs.copyFileSync(
          path.join(migrationsDir, name, 'migration.sql'),
          path.join(scratch, name, 'migration.sql'),
        );
      }
      const diff = ['migrate', 'diff', '--from-migrations', scratch, '--to-schema-datasource'];
      runSync(cmd, [...prefix, ...diff, schemaPath, '--exit-code'], opts);
      return true;
    } catch (err: any) {
      if (err?.status === 2) return false;
      log.warn(
        `[DBMigrate] Could not compare the tables with the migration history: ${cliOutput(err)}`,
      );
      return null;
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  };

  const plan = planSchemaSync(history, localMigrationsIn(migrationsDir), historyMatchesTables);
  const announce = `[DBMigrate] Syncing database schema (${plan.command}) at ${where}: ${plan.reason}.`;
  // A database with a history that leaves migrate deploy is worth a look.
  if (history && plan.command === 'db push') log.warn(announce);
  else log.info(announce);

  const args =
    plan.command === 'db push'
      ? [
          ...prefix,
          'db',
          'push',
          '--skip-generate',
          ...(plan.acceptDataLoss ? ['--accept-data-loss'] : []),
          '--schema',
          schemaPath,
        ]
      : [...prefix, 'migrate', 'deploy', '--schema', schemaPath];
  try {
    runSync(cmd, args, opts);
    log.info('[DBMigrate] Database schema in sync.');
  } catch (err: any) {
    const msg = cliOutput(err);
    log.error(`[DBMigrate] prisma ${plan.command} failed: ${msg}`);
    // Boot must not continue. The schema is not what the code expects, so the
    // next query fails somewhere unrelated — `prisma.user.count()` reporting a
    // missing User table, say — and buries this, the actual cause. Stop here
    // and hand back something the operator can act on.
    throw new Error(
      schemaSyncFailure(plan, msg, {
        prisma: [cmd, ...prefix].map(shellWord).join(' '),
        schema: schemaPath,
        databaseUrl: file ? `file:${file}` : databaseUrl,
        file,
      }),
    );
  }
}

/** The startup step: `syncDatabaseSchema`, unless XENON_AUTO_MIGRATE=false. */
export async function runMigrations(
  runSync: SchemaSyncRunner = execFileSync as SchemaSyncRunner,
  readHistory: HistoryReader = readMigrationHistory,
): Promise<void> {
  if (!config.autoMigrate) {
    log.info(
      '[DBMigrate] Auto-migrate disabled by XENON_AUTO_MIGRATE=false. Bring the schema up ' +
        'to date yourself before the server starts: `prisma migrate deploy` for a database ' +
        'whose migration history (`_prisma_migrations`) matches its tables (`prisma migrate ' +
        'diff --from-migrations <the recorded ones> --to-schema-datasource prisma/schema.prisma ' +
        '--exit-code` says so), `prisma db push` for any other (a `migrate deploy` that stops ' +
        'with P3018 on a change already there means the database is one of those), or ' +
        '`npm run db:migrate` from a source checkout, which chooses for you.',
    );
    return;
  }
  await syncDatabaseSchema(runSync, readHistory);
}
