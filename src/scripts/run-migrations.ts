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
 * So a database whose history is true to its tables gets `migrate deploy`. A
 * database with no history gets `db push`, as the default setting always did:
 * a new one, or one that `db push` made (the default, `npm run db:migrate`).
 * `databaseProvider` plays no part.
 *
 * A history that isn't true to its tables is repaired where it can be, since
 * `db push` writes no history and would keep such a database on `db push` for
 * good, which refuses (without `--accept-data-loss`) the first migration that
 * drops a column or adds a unique index:
 *
 * 1. Re-baselining. When the tables are exactly what the first k migrations
 *    make (`db push` moved them past the history, or a failed migration's
 *    change is there or never got there), the history is made to say so:
 *    `migrate resolve --rolled-back` for a failed migration, `--applied` for
 *    each of the first k it doesn't record. Then `migrate deploy`.
 * 2. A copy. When no run of the migrations matches, as when something was
 *    added to the tables by hand, `migrate deploy` is tried on a copy of the
 *    file next to it (`VACUUM INTO`). If it works there, it runs on the file.
 * 3. Otherwise `db push` without `--accept-data-loss`. The tables that differ
 *    may be ones somebody added by hand, or the half-finished copy a failed
 *    migration left, holding the only copy of their rows: `db push` without
 *    the flag refuses to drop a table or column that holds data, and the start
 *    stops with the commands to run (`schemaSyncFailure`). It still drops an
 *    index, an empty table or an empty column without asking.
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
  /** The tables are what the first k migrations make: correct the history, then `migrate deploy`. */
  | 'rebaselined'
  /** The tables match no run of the migrations: a copy, then `db push`. */
  | 'tables-differ'
  /** A failed migration recorded, and the tables match no run of the migrations: a copy, then `db push`. */
  | 'failed-migration';

/** What became of trying `migrate deploy` on a copy of the database. */
export type CopyTrial =
  | { outcome: 'worked' }
  | { outcome: 'failed'; output: string; migration: string | null }
  | {
      outcome: 'skipped';
      why: 'space' | 'locked' | 'copy';
      detail: string;
      /** For `space`: what the copy needs free next to the file. */
      neededBytes?: number;
    };

export interface SchemaSyncPlan {
  command: SchemaSyncCommand;
  /** `db push --accept-data-loss`: only for a database with no history, as the default always did. */
  acceptDataLoss: boolean;
  /** Why this command, for the log. */
  reason: string;
  basis: SchemaSyncBasis;
  /** The failed migrations the history records. */
  failed: string[];
  /** For `rebaselined`: what to record before `migrate deploy`, in this order. */
  resolve?: { rolledBack: string[]; applied: string[] };
  /** For `db push` on a database with a history: how the copy went. */
  trial?: CopyTrial;
}

/** What a test can put in place of the server's own pieces. */
export interface SchemaSyncOptions {
  /** The plugin root: prisma/schema.prisma, prisma/migrations and node_modules/.bin/prisma. */
  root?: string;
  /** Copies a SQLite file consistently. `VACUUM INTO` through a short-lived Prisma client. */
  copyDatabase?: (from: string, to: string) => Promise<void>;
  /** Free bytes in a directory, or null when it can't tell. `fs.statfsSync`. */
  freeBytes?: (dir: string) => number | null;
}

/**
 * The longest run of the migrations whose tables are these: the largest k for
 * which `tablesMatch(first k)` holds. It never goes below the last migration
 * the history records, and gives up (null) if a comparison can't be made.
 * Every migration comes first, as `db push` leaves the tables, then the
 * history's own, then the rest from the top.
 */
function rebaseline(
  history: MigrationHistory,
  localMigrations: string[],
  tablesMatch: (migrations: string[]) => boolean | null,
  known: Map<number, boolean | null>,
): number | null {
  const local = new Set(localMigrations);
  // A history from a later release, or a failed migration this one doesn't have.
  if ([...history.applied, ...history.failed].some((name) => !local.has(name))) return null;
  const applied = new Set(history.applied);
  const lowest = localMigrations.reduce((last, name, i) => (applied.has(name) ? i + 1 : last), 0);
  const order = [localMigrations.length, lowest];
  for (let k = localMigrations.length - 1; k > lowest; k--) order.push(k);
  for (const k of new Set(order)) {
    const matches = known.has(k) ? known.get(k) : tablesMatch(localMigrations.slice(0, k));
    if (matches === true) return k;
    if (matches === null) return null;
  }
  return null;
}

/**
 * Which command brings a database up to date, and what to record first.
 * `tablesMatch` is asked only about a database with migrations left to apply
 * or a failed one recorded. Given a run of migrations, it says whether the
 * tables are what they make, or null when it can't tell.
 */
export function planSchemaSync(
  history: MigrationHistory | null,
  localMigrations: string[],
  tablesMatch: (migrations: string[]) => boolean | null,
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
  const applied = new Set(history.applied);
  const recorded = localMigrations.filter((name) => applied.has(name));
  const known = new Map<number, boolean | null>();
  if (history.failed.length === 0) {
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
    const matches = tablesMatch(recorded);
    if (matches !== false) {
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
    // The history's own run, already compared, when it is the first n.
    if (recorded.every((name, i) => localMigrations[i] === name)) {
      known.set(recorded.length, false);
    }
  }

  const k = rebaseline(history, localMigrations, tablesMatch, known);
  if (k !== null) {
    const toRecord = localMigrations.slice(0, k).filter((name) => !applied.has(name));
    const failed = history.failed;
    return {
      command: 'migrate deploy',
      acceptDataLoss: false,
      reason:
        `its tables are what its first ${k} migrations make, though its history records ` +
        `${recorded.length}` +
        (failed.length ? ` and a failed one (${failed.join(', ')})` : '') +
        ': Xenon ' +
        (failed.length ? `marks ${failed.join(', ')} rolled back, ` : '') +
        (toRecord.length ? `records ${toRecord.join(', ')} as applied, ` : '') +
        'then runs migrate deploy',
      basis: 'rebaselined',
      failed,
      resolve: { rolledBack: failed, applied: toRecord },
    };
  }

  if (history.failed.length > 0) {
    return {
      command: 'db push',
      acceptDataLoss: false,
      reason:
        `its migration history records a failed migration (${history.failed.join(', ')}), ` +
        'which migrate deploy will not get past, and its tables match no run of the migrations',
      basis: 'failed-migration',
      failed: history.failed,
    };
  }
  return {
    command: 'db push',
    acceptDataLoss: false,
    reason:
      'its tables differ from what its recorded migrations make, and from what any longer ' +
      'run of the migrations makes (something was added to them by hand, say)',
    basis: 'tables-differ',
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

/**
 * A consistent copy of a SQLite file, made by SQLite itself (`VACUUM INTO`)
 * through a short-lived Prisma client, as the history is read. A copy of the
 * file's bytes alone would be wrong beside a hot journal or a WAL.
 */
async function copyWithVacuum(from: string, to: string): Promise<void> {
  const { PrismaClient } = await import('../generated/client');
  const client = new PrismaClient({ datasources: { db: { url: `file:${from}` } } });
  try {
    await client.$executeRawUnsafe(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
  } finally {
    await client.$disconnect();
  }
}

function freeBytesIn(dir: string): number | null {
  try {
    const stats = fs.statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
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
  return {
    copyTo(target: string): string {
      const statement = `VACUUM INTO '${target.replace(/'/g, "''")}'`;
      const quoted = /["$`\\!]/.test(statement) ? shellWord(statement) : `"${statement}"`;
      return `echo ${quoted} | ${at.prisma} db execute --url ${shellWord(at.databaseUrl)} --stdin`;
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

const megabytes = (bytes: number) => Math.ceil(bytes / (1024 * 1024));

/** What the copy told about the database, for a refusal's first sentence and its way to keep. */
function copyTrialText(trial: CopyTrial | undefined): { why: string; keep: string | null } {
  const thenTries =
    "and start again: Xenon then tries this version's migrations on a copy first, and uses " +
    'them if they work there.';
  if (!trial || trial.outcome === 'worked') return { why: '', keep: null };
  if (trial.outcome === 'failed') {
    return {
      why:
        ", and this version's migrations failed on a copy of it" +
        (trial.migration ? ` (${trial.migration})` : ''),
      keep: null,
    };
  }
  if (trial.why === 'space') {
    const free = trial.neededBytes
      ? `free ${megabytes(trial.neededBytes)} MB next to the file`
      : '';
    return {
      why: `, and there was no room next to it for a copy to try this version's migrations on (${trial.detail})`,
      keep: `To keep it, ${free || 'make room next to the file'} ${thenTries}`,
    };
  }
  if (trial.why === 'locked') {
    return {
      why: `, and it was locked, so Xenon could not copy it to try this version's migrations on (${trial.detail})`,
      keep: `To keep it, stop whatever else is using the file (another server?) ${thenTries}`,
    };
  }
  return {
    why: `, and Xenon could not copy it to try this version's migrations on (${trial.detail})`,
    keep: `To keep it, fix what stopped the copy ${thenTries}`,
  };
}

/**
 * What went wrong and what to do, then Prisma's own output. A refusal to
 * delete data gives the commands to run, with this server's paths, and never
 * sends `migrate deploy` to a database: it has been tried on a copy by then,
 * and it fails on one with a failed migration recorded (P3009) or with tables
 * ahead of its history (P3018, which records the migration as failed).
 * `step` names a failed call other than the plan's command.
 */
export function schemaSyncFailure(
  plan: SchemaSyncPlan,
  output: string,
  at: PrismaCommandLine,
  { now = new Date(), step }: { now?: Date; step?: string } = {},
): string {
  const where = describeDatabaseUrl(at.databaseUrl);
  const run = pasteable(at);
  let sentence: string;
  let after = '';
  if (step) {
    sentence =
      `prisma ${step} could not correct the migration history of the database at ${where}: ` +
      'back the file up and fix what Prisma reports below, then start again.';
  } else if (/Added the required column/i.test(output)) {
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
          'them by hand, say)';
    const trial = copyTrialText(plan.trial);
    const backup = at.file
      ? `Back the file up first:\n  ${run.copyTo(backupOf(at.file, now))}\n`
      : 'Back the database up first. ';
    sentence =
      'prisma db push stopped rather than delete what Prisma lists below from the database ' +
      `at ${where}. Xenon brings this database up to date with prisma db push because ${why}` +
      `${trial.why}. Without --accept-data-loss, db push deletes no table or column that ` +
      'holds data. ' +
      backup +
      `To let what is listed go, run this and start again:\n  ${run.letGo()}\n` +
      (trial.keep ?? 'To keep any of it, copy it out of the database first.');
    if (plan.trial?.outcome === 'failed') {
      after = `\n\nOn the copy, prisma migrate deploy said:\n${plan.trial.output}`;
    }
  } else if (/P3018/.test(output)) {
    const name = failedMigrationIn(output);
    sentence =
      `A migration${name ? `, ${name},` : ''} failed on the database at ${where}, and its ` +
      "migration history now records it as failed. Check Prisma's reason below. If the " +
      'migration failed on the rows in the database (a unique index over duplicate values, ' +
      'say), back the file up, change those rows, and start again: the next start runs it ' +
      'again. If what it makes is already there ("already exists", "duplicate column name"), ' +
      'start again: the next start compares the tables with the migrations before it runs any.';
  } else {
    sentence =
      `prisma ${plan.command} could not bring the database at ${where} up to date: back the ` +
      'file up and fix what Prisma reports below, or, if its schema already matches this ' +
      'version, set XENON_AUTO_MIGRATE=false to start without changing it.';
  }
  return `[DBMigrate] Cannot start: ${sentence}\n\n${output}${after}`;
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

/** Where a start tries the migrations: next to the file, named for this process. */
const TRIAL_INFIX = '.xenon-trial-';
/** Beyond twice the file's size (the copy, and a migration that copies a table), for the copy. */
const TRIAL_MARGIN_BYTES = 64 * 1024 * 1024;

function removeTrialFiles(copy: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    fs.rmSync(`${copy}${suffix}`, { force: true });
  }
}

/** Whether a process is running. Signal 0 only asks; it sends nothing. */
function processIsRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/** Removes the copies earlier starts left next to the file, unless their process still runs. */
function sweepTrialCopies(file: string): void {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}${TRIAL_INFIX}`;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const match = /^(\d+)(-journal|-wal|-shm)?$/.exec(name.slice(prefix.length));
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid !== process.pid && processIsRunning(pid)) continue;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
      log.info(`[DBMigrate] Removed ${name}, a copy of the database an earlier start left.`);
    } catch (err: any) {
      log.warn(`[DBMigrate] Could not remove ${name}, left by an earlier start: ${err?.message}`);
    }
  }
}

/**
 * `migrate deploy` on a copy of the file, next to it (not in os.tmpdir(), which
 * can be RAM-backed), with any failed migration rolled back there first. The
 * copy is skipped when there isn't room for it or the file can't be copied,
 * and it is deleted whatever happens.
 */
async function tryMigrationsOnCopy(
  file: string,
  failed: string[],
  migrate: (args: string[], databaseUrl: string) => unknown,
  options: Required<Pick<SchemaSyncOptions, 'copyDatabase' | 'freeBytes'>>,
): Promise<CopyTrial> {
  const copy = `${file}${TRIAL_INFIX}${process.pid}`;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch (err: any) {
    return { outcome: 'skipped', why: 'copy', detail: String(err?.message ?? err) };
  }
  const neededBytes = size * 2 + TRIAL_MARGIN_BYTES;
  const free = options.freeBytes(path.dirname(file));
  if (free === null || free < neededBytes) {
    return {
      outcome: 'skipped',
      why: 'space',
      neededBytes,
      detail:
        free === null
          ? `Xenon could not tell how much space is free; the copy needs ${megabytes(neededBytes)} MB`
          : `the copy needs ${megabytes(neededBytes)} MB and ${megabytes(free)} MB is free`,
    };
  }
  try {
    removeTrialFiles(copy);
    try {
      await options.copyDatabase(file, copy);
    } catch (err: any) {
      const message = String(err?.meta?.message ?? err?.message ?? err).trim();
      const locked = /database is locked|SQLITE_BUSY|busy/i.test(message);
      return { outcome: 'skipped', why: locked ? 'locked' : 'copy', detail: message };
    }
    try {
      for (const name of failed) {
        migrate(['migrate', 'resolve', '--rolled-back', name], `file:${copy}`);
      }
      migrate(['migrate', 'deploy'], `file:${copy}`);
      return { outcome: 'worked' };
    } catch (err: any) {
      const output = cliOutput(err);
      return { outcome: 'failed', output, migration: failedMigrationIn(output) };
    }
  } finally {
    removeTrialFiles(copy);
  }
}

/**
 * Bring the database at `config.databaseUrl` up to date with prisma/schema.prisma,
 * by the rule above. Throws an Error whose message says what to do when it can't.
 * `npm run db:migrate` runs this too, whatever XENON_AUTO_MIGRATE says.
 */
export async function syncDatabaseSchema(
  runSync: SchemaSyncRunner = execFileSync as SchemaSyncRunner,
  readHistory: HistoryReader = readMigrationHistory,
  options: SchemaSyncOptions = {},
): Promise<SchemaSyncPlan | undefined> {
  const rootDir = options.root ?? resolvePluginRoot();
  const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
  const migrationsDir = path.join(rootDir, 'prisma', 'migrations');

  if (!fs.existsSync(schemaPath) || !fs.existsSync(migrationsDir)) {
    log.warn(`[DBMigrate] Skipping auto-migrate: schema or migrations missing at ${rootDir}`);
    return undefined;
  }

  const databaseUrl = config.databaseUrl;
  const where = describeDatabaseUrl(databaseUrl);
  // The file the CLI will use: a relative path is read from prisma/, as Prisma does.
  const file = sqliteFilePath(databaseUrl, path.dirname(schemaPath));
  fs.mkdirSync(path.dirname(file ?? config.databasePath), { recursive: true });
  if (file) sweepTrialCopies(file);

  const { cmd, prefix } = resolvePrismaInvocation(rootDir);
  /** A prisma call against a database: this one unless another URL is given. */
  const prisma = (args: string[], url = databaseUrl) =>
    runSync(cmd, [...prefix, ...args, '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      cwd: rootDir,
      stdio: 'pipe',
    });

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

  // Would this run of migrations make exactly these tables? Built from this
  // release's copies of them, in a scratch directory.
  const tablesMatch = (migrations: string[]): boolean | null => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-migration-history-'));
    try {
      const lock = path.join(migrationsDir, 'migration_lock.toml');
      if (fs.existsSync(lock)) fs.copyFileSync(lock, path.join(scratch, 'migration_lock.toml'));
      for (const name of migrations) {
        fs.mkdirSync(path.join(scratch, name));
        fs.copyFileSync(
          path.join(migrationsDir, name, 'migration.sql'),
          path.join(scratch, name, 'migration.sql'),
        );
      }
      const diff = ['migrate', 'diff', '--from-migrations', scratch, '--to-schema-datasource'];
      runSync(cmd, [...prefix, ...diff, schemaPath, '--exit-code'], {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        cwd: rootDir,
        stdio: 'pipe',
      });
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

  const plan = planSchemaSync(history, localMigrationsIn(migrationsDir), tablesMatch);
  const tryCopy = Boolean(history && file && plan.command === 'db push');
  const how = tryCopy ? 'migrate deploy on a copy first, else db push' : plan.command;
  const announce = `[DBMigrate] Syncing database schema (${how}) at ${where}: ${plan.reason}.`;
  // A database with a history that leaves plain migrate deploy is worth a look.
  if (history && (plan.command === 'db push' || plan.basis === 'rebaselined')) log.warn(announce);
  else log.info(announce);

  const at: PrismaCommandLine = {
    prisma: [cmd, ...prefix].map(shellWord).join(' '),
    schema: schemaPath,
    databaseUrl: file ? `file:${file}` : databaseUrl,
    file,
  };
  let step: string | undefined;
  let ran: SchemaSyncPlan = plan;
  try {
    if (plan.command === 'migrate deploy') {
      for (const name of plan.resolve?.rolledBack ?? []) {
        step = `migrate resolve --rolled-back ${name}`;
        log.info(`[DBMigrate] Marking ${name} rolled back in the migration history.`);
        prisma(['migrate', 'resolve', '--rolled-back', name]);
      }
      for (const name of plan.resolve?.applied ?? []) {
        step = `migrate resolve --applied ${name}`;
        log.info(`[DBMigrate] Recording ${name} as applied: the tables already have it.`);
        prisma(['migrate', 'resolve', '--applied', name]);
      }
      step = undefined;
      prisma(['migrate', 'deploy']);
    } else {
      if (tryCopy && file) {
        log.info(
          "[DBMigrate] Trying this version's migrations on a copy of the database first " +
            `(${path.basename(file)}${TRIAL_INFIX}${process.pid}, next to it).`,
        );
        const trial = await tryMigrationsOnCopy(file, plan.failed, prisma, {
          copyDatabase: options.copyDatabase ?? copyWithVacuum,
          freeBytes: options.freeBytes ?? freeBytesIn,
        });
        if (trial.outcome === 'worked') {
          log.info(
            "[DBMigrate] This version's migrations worked on the copy, so Xenon runs prisma " +
              'migrate deploy on the database.',
          );
          ran = { ...plan, command: 'migrate deploy', trial };
          for (const name of plan.failed) {
            step = `migrate resolve --rolled-back ${name}`;
            prisma(['migrate', 'resolve', '--rolled-back', name]);
          }
          step = undefined;
          prisma(['migrate', 'deploy']);
          log.info('[DBMigrate] Database schema in sync.');
          return ran;
        }
        log.warn(
          trial.outcome === 'failed'
            ? "[DBMigrate] This version's migrations failed on the copy" +
                (trial.migration ? ` (${trial.migration})` : '') +
                ', so Xenon brings the database up to date with prisma db push.'
            : `[DBMigrate] Xenon did not try the migrations on a copy: ${trial.detail}.`,
        );
        ran = { ...plan, trial };
      }
      prisma([
        'db',
        'push',
        '--skip-generate',
        ...(plan.acceptDataLoss ? ['--accept-data-loss'] : []),
      ]);
    }
    log.info('[DBMigrate] Database schema in sync.');
    return ran;
  } catch (err: any) {
    const msg = cliOutput(err);
    log.error(`[DBMigrate] prisma ${step ?? ran.command} failed: ${msg}`);
    // Boot must not continue. The schema is not what the code expects, so the
    // next query fails somewhere unrelated — `prisma.user.count()` reporting a
    // missing User table, say — and buries this, the actual cause. Stop here
    // and hand back something the operator can act on.
    throw new Error(schemaSyncFailure(ran, msg, at, { step }));
  }
}

/**
 * Whether prisma/schema.prisma has changes no migration in prisma/migrations
 * makes, with a warning when it has; null when it can't tell. `npm run
 * db:migrate` asks: a database with a migration history is updated with
 * `migrate deploy`, which applies migrations only, so it never gets them (nor
 * does any server this release reaches), while the log says it is in sync.
 * `npm run db:generate` gives the developer's database a history.
 */
export function warnOfUnmigratedSchemaChanges(
  runSync: SchemaSyncRunner = execFileSync as SchemaSyncRunner,
  options: SchemaSyncOptions = {},
): boolean | null {
  const rootDir = options.root ?? resolvePluginRoot();
  const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
  const migrationsDir = path.join(rootDir, 'prisma', 'migrations');
  if (!fs.existsSync(schemaPath) || !fs.existsSync(migrationsDir)) return null;
  const { cmd, prefix } = resolvePrismaInvocation(rootDir);
  try {
    runSync(
      cmd,
      [
        ...prefix,
        'migrate',
        'diff',
        '--from-migrations',
        migrationsDir,
        '--to-schema-datamodel',
        schemaPath,
        '--exit-code',
      ],
      { env: { ...process.env, DATABASE_URL: config.databaseUrl }, cwd: rootDir, stdio: 'pipe' },
    );
    return false;
  } catch (err: any) {
    if (err?.status === 2) {
      log.warn(
        '[DBMigrate] prisma/schema.prisma has changes that no migration in prisma/migrations ' +
          'makes. Add one with `npm run db:generate -- --name <change>`: a database with a ' +
          'migration history is brought up to date with prisma migrate deploy, which applies ' +
          'migrations only, so it never gets these changes, and nor does any server this ' +
          'release reaches, even where the log says the schema is in sync.',
      );
      return true;
    }
    log.warn(
      `[DBMigrate] Could not compare prisma/schema.prisma with prisma/migrations: ${cliOutput(err)}`,
    );
    return null;
  }
}

/** The startup step: `syncDatabaseSchema`, unless XENON_AUTO_MIGRATE=false. */
export async function runMigrations(
  runSync: SchemaSyncRunner = execFileSync as SchemaSyncRunner,
  readHistory: HistoryReader = readMigrationHistory,
  options: SchemaSyncOptions = {},
): Promise<void> {
  if (!config.autoMigrate) {
    log.info(
      '[DBMigrate] Auto-migrate disabled by XENON_AUTO_MIGRATE=false. Bring the schema up ' +
        'to date yourself before the server starts: `prisma migrate deploy` for a database ' +
        'whose migration history (`_prisma_migrations`) matches its tables (`prisma migrate ' +
        'diff --from-migrations <the recorded ones> --to-schema-datasource prisma/schema.prisma ' +
        '--exit-code` says so), `prisma db push` for any other (a `migrate deploy` that stops ' +
        'with P3018 on a change already there means the database is one of those, until ' +
        '`prisma migrate resolve --applied` records the migrations its tables already have), ' +
        'or `npm run db:migrate` from a source checkout, which chooses for you.',
    );
    return;
  }
  await syncDatabaseSchema(runSync, readHistory, options);
}
