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
 * drops a column or adds a unique index. Xenon only writes to the history what
 * the tables show. Prisma's comparison sees tables, columns and indexes, never
 * what a migration did to the rows (a backfill), nor a trigger, a view or an
 * index's collation (`migrationShape` reads those out of a migration's SQL):
 *
 * 1. Re-baselining. When the tables are exactly what the first k migrations
 *    make (`db push` moved them past the history, or a failed migration's
 *    change is there or never got there), the history is made to say so:
 *    `migrate resolve --applied` for each of the first k it doesn't record,
 *    then `migrate deploy`. k is the lowest of the run of matches at the top,
 *    so a migration that makes the same tables as the one before it (a
 *    backfill) is run, never recorded. Each one recorded must change only
 *    what the tables show; if one doesn't, the history is left as it is and
 *    the database gets `db push`, as it did before. A failed migration is
 *    recorded as applied only when its error says what it makes was there
 *    already (the `db push` case) and it changes only what the tables show.
 *    It is rolled back for `migrate deploy` to run again only when the tables
 *    show none of it and it can't have done part of its work (one statement,
 *    which SQLite undoes whole, or only what the tables show). Otherwise the
 *    history is left as it is, and the start stops and says how to finish or
 *    undo it by hand.
 * 2. A copy. When no run of the migrations matches, as when something was
 *    added to the tables by hand, and the tables have everything their
 *    recorded migrations make, `migrate deploy` is tried on a copy of the file
 *    next to it (`VACUUM INTO`), a failed migration rolled back there first
 *    (by the rule above). If it works there, and the copy then has everything
 *    prisma/schema.prisma has, it runs on the file. A history that names a
 *    migration this release doesn't have is another release's, and gets
 *    neither re-baselining nor a copy.
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

/** `none`: nothing Xenon can run is right for the database, so the start stops and says what to do. */
export type SchemaSyncCommand = 'db push' | 'migrate deploy' | 'none';

/** What a database's `_prisma_migrations` table records. */
export interface MigrationHistory {
  /** Migrations that finished and weren't rolled back. */
  applied: string[];
  /** Migrations that started and never finished or were rolled back: `migrate deploy` stops on these (P3009). */
  failed: string[];
  /** What Prisma wrote down when each failed migration failed (`logs`): its error. */
  failureLogs?: Record<string, string>;
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
  /**
   * The tables are what the first k migrations make, but one the history lacks
   * among them changes what the tables can't show: `db push`, no copy.
   */
  | 'unrecordable'
  /** A failed migration whose record Xenon can't safely change: no command; the start stops. */
  | 'failed-unresolved'
  /** The history names migrations this release doesn't have: `db push`, no copy. */
  | 'other-release'
  /** The tables match no run of the migrations: a copy, then `db push`. */
  | 'tables-differ'
  /** A failed migration recorded, and the tables match no run of the migrations: a copy, then `db push`. */
  | 'failed-migration';

/** What became of trying `migrate deploy` on a copy of the database. */
export type CopyTrial =
  | { outcome: 'worked' }
  | { outcome: 'failed'; output: string; migration: string | null }
  /**
   * Not tried, because the tables lack part of what their recorded migrations
   * make (`before`), or tried, and the copy then lacked part of
   * prisma/schema.prisma (`after`): Prisma's lines for what is missing.
   */
  | { outcome: 'incomplete'; stage: 'before' | 'after'; missing: string }
  | {
      outcome: 'skipped';
      why: 'space' | 'locked' | 'copy';
      detail: string;
      /** For `space`: what the copy needs free next to the file. */
      neededBytes?: number;
    };

/** Why Xenon leaves a failed migration's record alone. */
export type UnresolvedWhy =
  /**
   * It failed on what was already in the tables, but it also changes what
   * they can't show (rows, a trigger, a view, a collation), which never ran.
   */
  | 'unseen-part'
  /** It failed on something else (the rows), so part of it may have run. */
  | 'part-way';

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
  /** For `other-release`: the migrations the history names that this release doesn't have. */
  unknown?: string[];
  /** For `unrecordable`: the migrations the tables can't vouch for. */
  unseen?: string[];
  /** For `failed-unresolved`: the migration, why, and what Prisma wrote down when it failed. */
  unresolved?: { migration: string; why: UnresolvedWhy; logs: string };
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

/** What a migration's SQL does that a comparison of tables can and can't check. */
export interface MigrationShape {
  /** Its statements, PRAGMAs left out. */
  statements: number;
  /**
   * The statements whose effect the tables can't show: one that changes rows
   * (other than the copy of a table Prisma redefines), a trigger, a view, a
   * collation, anything else that isn't a table or an index. Empty when the
   * tables show all it does.
   */
  unseen: string[];
}

/** A script's statements, without comments, split where a `;` ends one outside quotes. */
function sqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  while (i < script.length) {
    const c = script[i];
    if (c === '-' && script[i + 1] === '-') {
      const end = script.indexOf('\n', i);
      i = end === -1 ? script.length : end;
      current += ' ';
    } else if (c === '/' && script[i + 1] === '*') {
      const end = script.indexOf('*/', i + 2);
      i = end === -1 ? script.length : end + 2;
      current += ' ';
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < script.length) {
        if (script[j] === close && close !== ']' && script[j + 1] === close) j += 2;
        else if (script[j] === close) break;
        else j++;
      }
      current += script.slice(i, j + 1);
      i = j + 1;
    } else if (c === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i++;
    } else {
      current += c;
      i++;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** The part of a statement a table comparison sees: a table, a column, an index. */
const SEEN_DDL = /^(CREATE (UNIQUE )?INDEX|CREATE TABLE|ALTER TABLE|DROP TABLE|DROP INDEX)\b/;
/** Prisma's copy of a table it redefines: every row, into the table that replaces it. */
const REDEFINE_COPY = /^INSERT INTO "new_([^"]+)" \([^)]*\) SELECT .* FROM "\1"$/;

/** What a migration does that the tables can and can't show. */
export function migrationShape(script: string): MigrationShape {
  let statements = 0;
  const unseen: string[] = [];
  for (const statement of sqlStatements(script)) {
    const flat = statement.replace(/\s+/g, ' ');
    const upper = flat.toUpperCase();
    if (upper.startsWith('PRAGMA ')) continue;
    statements++;
    const seen =
      (SEEN_DDL.test(upper) &&
        !/\bCOLLATE\b/.test(upper) &&
        !/^CREATE TABLE .* AS SELECT\b/.test(upper)) ||
      REDEFINE_COPY.test(flat);
    if (!seen) unseen.push(flat.length > 60 ? `${flat.slice(0, 57)}...` : flat);
  }
  return { statements, unseen };
}

/** Whether a migration that failed can be run again without doing any of it twice. */
function rerunnable(shape: MigrationShape): boolean {
  // A failed statement changed nothing (SQLite undoes it), so one statement
  // did nothing. Several whose every effect shows: a part that ran is still
  // there, and running it again fails on it rather than doing it twice.
  return shape.statements <= 1 || shape.unseen.length === 0;
}

/** Whether a failed migration's error says what it makes was already there. */
export function failedOnWhatWasThere(logs: string | undefined): boolean {
  return /already exists|duplicate column name/i.test(logs ?? '');
}

/** For a planner given no SQL: every migration changes only what the tables show. */
const SHOWN: (name: string) => MigrationShape = () => ({ statements: 1, unseen: [] });

/**
 * The run of the migrations whose tables are these: the largest k for which
 * `tablesMatch(first k)` holds, then down while `tablesMatch(first k - 1)`
 * holds too. Two runs that make the same tables differ by migrations the
 * comparison can't see (a backfill), which must run rather than be recorded.
 * It never goes below the last migration the history records, and gives up
 * (null) if a comparison can't be made. Every migration comes first, as `db
 * push` leaves the tables, then the history's own, then the rest from the top.
 */
function rebaseline(
  history: MigrationHistory,
  localMigrations: string[],
  tablesMatch: (migrations: string[]) => boolean | null,
  known: Map<number, boolean | null>,
): number | null {
  const applied = new Set(history.applied);
  const lowest = localMigrations.reduce((last, name, i) => (applied.has(name) ? i + 1 : last), 0);
  const ask = (k: number): boolean | null => {
    if (!known.has(k)) known.set(k, tablesMatch(localMigrations.slice(0, k)));
    return known.get(k) as boolean | null;
  };
  const order = [localMigrations.length, lowest];
  for (let k = localMigrations.length - 1; k > lowest; k--) order.push(k);
  for (let k of new Set(order)) {
    const matches = ask(k);
    if (matches === null) return null;
    if (matches === false) continue;
    while (k > lowest) {
      const below = ask(k - 1);
      if (below === null) return null;
      if (below === false) break;
      k--;
    }
    return k;
  }
  return null;
}

/**
 * Which command brings a database up to date, and what to record first.
 * `tablesMatch` is asked only about a database with migrations left to apply
 * or a failed one recorded. Given a run of migrations, it says whether the
 * tables are what they make, or null when it can't tell. `shapeOf` says what
 * a migration does that the tables can't show.
 */
export function planSchemaSync(
  history: MigrationHistory | null,
  localMigrations: string[],
  tablesMatch: (migrations: string[]) => boolean | null,
  shapeOf: (migration: string) => MigrationShape = SHOWN,
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

  // A history from a later release, or another branch's: not this release's to rewrite or run.
  const local = new Set(localMigrations);
  const unknown = [...history.applied, ...history.failed].filter((name) => !local.has(name));
  if (unknown.length > 0) {
    return {
      command: 'db push',
      acceptDataLoss: false,
      reason:
        `its migration history names ${unknown.length} migration(s) this version doesn't have ` +
        `(${unknown.join(', ')}), so another release of Xenon brought it up to date: Xenon ` +
        "doesn't change its history or try this version's migrations on it",
      basis: 'other-release',
      failed: history.failed,
      unknown,
    };
  }

  const failed = history.failed;
  const logsOf = (name: string) => history.failureLogs?.[name] ?? '';
  const unresolved = (migration: string, why: UnresolvedWhy, detail: string): SchemaSyncPlan => ({
    command: 'none',
    acceptDataLoss: false,
    reason:
      `its migration history records ${migration} as failed, and ${detail}: Xenon neither ` +
      'runs it again nor records it as applied',
    basis: 'failed-unresolved',
    failed,
    unresolved: { migration, why, logs: logsOf(migration) },
  });

  const k = rebaseline(history, localMigrations, tablesMatch, known);
  if (k !== null) {
    const within = new Set(localMigrations.slice(0, k));
    const toRecord = localMigrations.slice(0, k).filter((name) => !applied.has(name));
    for (const name of failed) {
      const shape = shapeOf(name);
      if (within.has(name)) {
        // The tables have what it makes: recorded as applied only if it failed
        // because that was there already, and it does nothing they can't show.
        if (!failedOnWhatWasThere(logsOf(name))) {
          return unresolved(
            name,
            'part-way',
            'the tables have what it makes, though it failed on something other than that ' +
              'being there already, so part of it may have run before it failed',
          );
        }
        if (shape.unseen.length > 0) {
          return unresolved(
            name,
            'unseen-part',
            'what it makes was in the tables already when it ran, but it also changes what ' +
              `the tables can't show (${shape.unseen[0]}), which never ran`,
          );
        }
      } else if (!rerunnable(shape)) {
        return unresolved(
          name,
          'part-way',
          `its ${shape.statements} statements change what the tables can't show ` +
            `(${shape.unseen[0]}), so the tables can't tell how many of them ran before it failed`,
        );
      }
    }
    const unseen = toRecord.filter(
      (name) => !failed.includes(name) && shapeOf(name).unseen.length > 0,
    );
    if (unseen.length > 0) {
      return {
        command: 'db push',
        acceptDataLoss: false,
        reason:
          `its tables are what its first ${k} migrations make, though its history records ` +
          `${recorded.length}, but ${unseen.join(', ')} ${unseen.length > 1 ? 'change' : 'changes'} ` +
          `what the tables can't show (${shapeOf(unseen[0]).unseen[0]}), so Xenon can't tell ` +
          'whether that part ran, leaves the history as it is and uses db push, as before',
        basis: 'unrecordable',
        failed,
        unseen,
      };
    }
    const rolledBack = failed;
    return {
      command: 'migrate deploy',
      acceptDataLoss: false,
      reason:
        `its tables are what its first ${k} migrations make, though its history records ` +
        `${recorded.length}` +
        (failed.length ? ` and a failed one (${failed.join(', ')})` : '') +
        ': Xenon ' +
        (rolledBack.length ? `marks ${rolledBack.join(', ')} rolled back, ` : '') +
        (toRecord.length ? `records ${toRecord.join(', ')} as applied, ` : '') +
        'then runs migrate deploy',
      basis: 'rebaselined',
      failed,
      resolve: { rolledBack, applied: toRecord },
    };
  }

  if (failed.length > 0) {
    // The copy runs a failed migration again: only one that can't do half its work twice.
    const unsafe = failed.find((name) => !rerunnable(shapeOf(name)));
    if (unsafe) {
      const shape = shapeOf(unsafe);
      return unresolved(
        unsafe,
        'part-way',
        `its ${shape.statements} statements change what the tables can't show ` +
          `(${shape.unseen[0]}), so the tables can't tell how many of them ran before it failed`,
      );
    }
    return {
      command: 'db push',
      acceptDataLoss: false,
      reason:
        `its migration history records a failed migration (${failed.join(', ')}), ` +
        'which migrate deploy will not get past, and its tables match no run of the migrations',
      basis: 'failed-migration',
      failed,
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

/** What Prisma wrote down when each failed migration failed; nothing when it can't be read. */
async function failureLogsIn(client: {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}): Promise<Record<string, string>> {
  try {
    const rows = await client.$queryRawUnsafe<{ migration_name: string; logs: unknown }[]>(
      'SELECT migration_name, logs FROM "_prisma_migrations" ' +
        'WHERE finished_at IS NULL AND rolled_back_at IS NULL',
    );
    return Object.fromEntries(rows.map((r) => [r.migration_name, String(r.logs ?? '')]));
  } catch {
    return {};
  }
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
    const failed = rows
      .filter((r) => !r.finished_at && !r.rolled_back_at)
      .map((r) => r.migration_name);
    return {
      applied: rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
      failed,
      ...(failed.length ? { failureLogs: await failureLogsIn(client) } : {}),
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
  /** The file's permission bits, which a backup gets too; null when unknown. */
  mode?: number | null;
  /** prisma/migrations, where a failed migration's SQL is. */
  migrationsDir?: string;
}

/** A word a POSIX shell reads as itself: quoted only when it has to be. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * The commands a failure's message gives, ready to paste. A copy is made with
 * SQLite's `VACUUM INTO` through `prisma db execute`, so it is consistent
 * whatever journal sits beside the file, and needs nothing but the CLI. It
 * goes into an empty file given the database's own mode first: `VACUUM INTO`
 * takes an empty file, and refuses one that isn't, so a backup never
 * overwrites another.
 */
function pasteable(at: PrismaCommandLine) {
  const schema = shellWord(at.schema);
  const url = shellWord(at.databaseUrl);
  return {
    backup(target: string): string {
      const statement = `VACUUM INTO '${target.replace(/'/g, "''")}'`;
      const quoted = /["$`\\!]/.test(statement) ? shellWord(statement) : `"${statement}"`;
      const copy = `echo ${quoted} | ${at.prisma} db execute --url ${url} --stdin`;
      if (at.mode === undefined || at.mode === null) return copy;
      const word = shellWord(target);
      const mode = (at.mode & 0o777).toString(8).padStart(3, '0');
      return `touch ${word} && chmod ${mode} ${word} && ${copy}`;
    },
    letGo(): string {
      return (
        `DATABASE_URL=${url} ${at.prisma} db push --skip-generate ` +
        `--accept-data-loss --schema ${schema}`
      );
    },
    resolve(flag: '--applied' | '--rolled-back', migration: string): string {
      return (
        `DATABASE_URL=${url} ${at.prisma} migrate resolve ${flag} ${shellWord(migration)} ` +
        `--schema ${schema}`
      );
    },
  };
}

/** A backup's name: the file's, stamped with the time to the millisecond. */
function backupOf(file: string, now: Date): string {
  return `${file}.backup-${now.toISOString().replace(/[-:.]/g, '')}`;
}

/** The migration a P3018 names, if it does. */
function failedMigrationIn(output: string): string | null {
  const match = /Migration name:\s*(\S+)/.exec(output);
  return match ? match[1] : null;
}

const megabytes = (bytes: number) => Math.ceil(bytes / (1024 * 1024));

/**
 * What a database lacks of what should be there (prisma/schema.prisma, or
 * what a run of migrations makes), from Prisma's summary of a diff from that
 * to the database: every line that removes or changes something (with its
 * table's line), or null when it only adds (what was added to the database
 * by hand) or finds nothing. A line it doesn't know counts as lacking.
 */
export function schemaMissingIn(summary: string): string | null {
  const missing: string[] = [];
  let header = '';
  for (const line of summary.split('\n').map((l) => l.trimEnd())) {
    if (!line.trim() || /^No difference detected\.?$/.test(line.trim())) continue;
    if (!/^\s/.test(line)) {
      // A table's heading: added tables, or a table whose lines say what changed.
      header = line;
      if (!/^\[\+\]/.test(line) && !/^\[\*\] Changed the `[^`]+` table$/.test(line)) {
        missing.push(line);
      }
      continue;
    }
    const item = line.trim();
    const adds = /^\[\+\]/.test(item) || (/^- /.test(item) && /^\[\+\]/.test(header));
    if (adds) continue;
    if (!missing.includes(header)) missing.push(header);
    missing.push(line);
  }
  return missing.length ? missing.join('\n') : null;
}

/** What the copy told about the database, for a refusal's first sentence and its way to keep. */
function copyTrialText(
  trial: CopyTrial | undefined,
  basis?: SchemaSyncBasis,
): { why: string; keep: string | null } {
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
  if (trial.outcome === 'incomplete' && trial.stage === 'before') {
    return {
      why:
        (basis === 'tables-differ'
          ? ': they lack part of what those make'
          : ', and its tables lack part of what its recorded migrations make') +
        " (listed at the end), so Xenon does not try this version's migrations on a copy of it",
      keep: `To keep it, add what the tables lack to the database ${thenTries}`,
    };
  }
  if (trial.outcome === 'incomplete') {
    return {
      why:
        ", and after this version's migrations a copy of it still lacked part of this " +
        "version's schema (listed at the end), so Xenon doesn't run them on it",
      keep:
        'To keep it, add what the copy lacked to the database (prisma/schema.prisma says what ' +
        `it is) ${thenTries}`,
    };
  }
  if (trial.why === 'space') {
    const free = trial.neededBytes
      ? `free ${megabytes(trial.neededBytes)} MB next to the file`
      : 'make room next to the file';
    return {
      why: `, and there was no room next to it for a copy to try this version's migrations on (${trial.detail})`,
      keep: `To keep it, ${free} ${thenTries}`,
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

/** Why `db push` was the command, for its refusal's first sentence. */
function dbPushBecause(plan: SchemaSyncPlan): { why: string; keep: string | null } {
  switch (plan.basis) {
    case 'failed-migration':
      return {
        why:
          `its migration history records a failed migration (${plan.failed.join(', ')}), ` +
          "which prisma migrate deploy won't run past",
        keep: null,
      };
    case 'other-release':
      return {
        why:
          'its migration history names migrations this version of Xenon does not have ' +
          `(${(plan.unknown ?? []).join(', ')}): another release brought it up to date`,
        keep: 'To keep it, start it with the release of Xenon that last brought it up to date.',
      };
    case 'unrecordable':
      return {
        why:
          'its tables are ahead of its migration history, and the migrations they are ahead ' +
          `by include ${(plan.unseen ?? []).join(', ')}, which change(s) what the tables ` +
          "can't show, so Xenon can't record them as applied",
        keep: null,
      };
    default:
      return {
        why:
          'its tables differ from what its recorded migrations make (something was added to ' +
          'them by hand, say)',
        keep: null,
      };
  }
}

/** What Prisma wrote down when a migration failed, without the engine's stack trace. */
function withoutStack(logs: string): string {
  return logs.split(/\n\s+0: /)[0].trim();
}

/** What to do about a failed migration Xenon neither runs again nor records as applied. */
function unresolvedAdvice(
  migration: string,
  why: UnresolvedWhy,
  where: string,
  at: PrismaCommandLine,
  now: Date,
): string {
  const run = pasteable(at);
  const sql = at.migrationsDir
    ? path.join(at.migrationsDir, migration, 'migration.sql')
    : `prisma/migrations/${migration}/migration.sql`;
  const reason =
    why === 'unseen-part'
      ? 'What it makes was already in the tables when it ran, but it also changes rows (or ' +
        "makes a trigger, a view or a collation), which the tables can't show, and that " +
        'part never ran'
      : "SQLite keeps what a migration's statements did up to the one that failed, so part " +
        'of it may be in the tables';
  return (
    `A migration, ${migration}, failed on the database at ${where}, and its migration ` +
    `history records it as failed (Prisma's reason is below). ${reason}: Xenon neither runs ` +
    'it again nor records it as applied. ' +
    (at.file
      ? `Back the file up:\n  ${run.backup(backupOf(at.file, now))}\n`
      : 'Back the database up. ') +
    `Then compare what it does (${sql}) with the tables and, once the rows it failed on are ` +
    "changed, either finish what it didn't do and record it as applied:\n" +
    `  ${run.resolve('--applied', migration)}\n` +
    'or undo what it did and record it as rolled back, so that the next start runs it again:\n' +
    `  ${run.resolve('--rolled-back', migration)}\n` +
    'Then start again.'
  );
}

/** What is known of the migration a P3018 names, for its message. */
export interface FailedMigrationFacts {
  migration: string;
  /** Its error says what it makes was already there. */
  wasThere: boolean;
  /** It does nothing the tables can't show. */
  shown: boolean;
  /** Nothing of it stayed in the tables, so running it again does none of it twice. */
  leftNothing: boolean;
}

/**
 * What went wrong and what to do, then Prisma's own output. A refusal to
 * delete data gives the commands to run, with this server's paths, and never
 * sends `migrate deploy` to a database: it has been tried on a copy by then,
 * or the copy couldn't be made or wasn't tried, and it fails on one with a
 * failed migration recorded (P3009) or with tables ahead of its history
 * (P3018, which records the migration as failed). `step` names a failed call
 * other than the plan's command; `failed` describes the migration a P3018
 * names.
 */
export function schemaSyncFailure(
  plan: SchemaSyncPlan,
  output: string,
  at: PrismaCommandLine,
  {
    now = new Date(),
    step,
    failed,
  }: { now?: Date; step?: string; failed?: FailedMigrationFacts } = {},
): string {
  const where = describeDatabaseUrl(at.databaseUrl);
  const run = pasteable(at);
  let sentence: string;
  let after = '';
  if (plan.basis === 'failed-unresolved' && plan.unresolved) {
    sentence = unresolvedAdvice(plan.unresolved.migration, plan.unresolved.why, where, at, now);
  } else if (step) {
    sentence =
      `prisma ${step} could not correct the migration history of the database at ${where}: ` +
      'back the file up and fix what Prisma reports below, then start again.';
  } else if (/Added the required column/i.test(output)) {
    sentence =
      `This version adds a required column to a table that already has rows in ${where}, ` +
      'which prisma db push cannot do: back the file up, then migrate it by hand or start ' +
      'from a fresh database.';
  } else if (/accept-data-loss|There might be data loss/i.test(output)) {
    const because = dbPushBecause(plan);
    const trial = copyTrialText(plan.trial, plan.basis);
    if (
      plan.basis === 'tables-differ' &&
      plan.trial?.outcome === 'incomplete' &&
      plan.trial.stage === 'before'
    ) {
      // Not (only) something added by hand: something missing, which the next words say.
      because.why = 'its tables differ from what its recorded migrations make';
    }
    sentence =
      'prisma db push stopped rather than delete what Prisma lists below from the database ' +
      `at ${where}. Xenon brings this database up to date with prisma db push because ` +
      `${because.why}${trial.why}. Without --accept-data-loss, db push deletes no table or ` +
      'column that holds data. ' +
      (at.file
        ? 'To let what is listed go, back the file up and let it go with this (nothing goes ' +
          `unless the backup is made), then start again:\n  ${run.backup(backupOf(at.file, now))}` +
          ` && ${run.letGo()}\n`
        : 'To let what is listed go, back the database up, then run this and start again:\n' +
          `  ${run.letGo()}\n`) +
      (trial.keep ?? because.keep ?? 'To keep any of it, copy it out of the database first.');
    if (plan.trial?.outcome === 'failed') {
      after = `\n\nOn the copy, prisma migrate deploy said:\n${plan.trial.output}`;
    } else if (plan.trial?.outcome === 'incomplete' && plan.trial.stage === 'before') {
      after =
        '\n\nThe tables lack this, which their recorded migrations make (prisma migrate diff ' +
        `from the recorded migrations to the tables):\n${plan.trial.missing}`;
    } else if (plan.trial?.outcome === 'incomplete') {
      after =
        "\n\nAfter this version's migrations, the copy still lacked this (prisma migrate diff " +
        `from prisma/schema.prisma to the copy):\n${plan.trial.missing}`;
    }
  } else if (/P3018/.test(output)) {
    const name = failed?.migration ?? failedMigrationIn(output);
    const failedOn = `A migration${name ? `, ${name},` : ''} failed on the database at ${where}`;
    if (failed && failed.wasThere && failed.shown) {
      sentence =
        `${failedOn}, because what it makes was already there (Prisma's reason is below), ` +
        'and its migration history now records it as failed. Start again: the next start ' +
        'records it as applied if the tables are what the migrations up to it make.';
    } else if (failed && !failed.wasThere && failed.leftNothing) {
      sentence =
        `${failedOn}, and its migration history now records it as failed. Check Prisma's ` +
        'reason below. If it failed on the rows in the database (a unique index over ' +
        'duplicate values, say), back the file up, change those rows, and start again: the ' +
        'next start runs it again.';
    } else if (failed) {
      sentence = unresolvedAdvice(
        failed.migration,
        failed.wasThere ? 'unseen-part' : 'part-way',
        where,
        at,
        now,
      );
    } else {
      sentence =
        `${failedOn}, and its migration history now records it as failed. Check Prisma's ` +
        'reason below, back the file up and fix it, then start again.';
    }
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
 * can be RAM-backed), with any failed migration rolled back there first, then
 * whether the copy has everything prisma/schema.prisma has (`lacks`): the
 * migrations make only what they make, so a copy they worked on can still lack
 * what the tables lacked before them (an index dropped by hand, a column an
 * older release's `db push` took away). The copy gets the file's own mode
 * before any data is in it. It is skipped when there isn't room for it or the
 * file can't be copied, and it is deleted whatever happens.
 */
async function tryMigrationsOnCopy(
  file: string,
  failed: string[],
  migrate: (args: string[], databaseUrl: string) => unknown,
  lacks: (databaseUrl: string) => string | null,
  options: Required<Pick<SchemaSyncOptions, 'copyDatabase' | 'freeBytes'>>,
): Promise<CopyTrial> {
  const copy = `${file}${TRIAL_INFIX}${process.pid}`;
  let stats: fs.Stats;
  try {
    stats = fs.statSync(file);
  } catch (err: any) {
    return { outcome: 'skipped', why: 'copy', detail: String(err?.message ?? err) };
  }
  const neededBytes = stats.size * 2 + TRIAL_MARGIN_BYTES;
  const free = options.freeBytes(path.dirname(file));
  if (free === null) {
    log.info(
      '[DBMigrate] Xenon could not tell how much space is free next to the database, so it ' +
        `tries the copy anyway (it needs about ${megabytes(neededBytes)} MB).`,
    );
  } else if (free < neededBytes) {
    return {
      outcome: 'skipped',
      why: 'space',
      neededBytes,
      detail: `the copy needs ${megabytes(neededBytes)} MB and ${megabytes(free)} MB is free`,
    };
  }
  try {
    removeTrialFiles(copy);
    try {
      // VACUUM INTO writes into an empty file, which keeps the mode it has.
      fs.writeFileSync(copy, '', { mode: stats.mode & 0o777 });
      fs.chmodSync(copy, stats.mode & 0o777);
      await options.copyDatabase(file, copy);
    } catch (err: any) {
      const message = String(err?.meta?.message ?? err?.message ?? err).trim();
      if (/disk is full|SQLITE_FULL|no space left|ENOSPC/i.test(message)) {
        return { outcome: 'skipped', why: 'space', neededBytes, detail: message };
      }
      const locked = /database is locked|SQLITE_BUSY|busy/i.test(message);
      return { outcome: 'skipped', why: locked ? 'locked' : 'copy', detail: message };
    }
    try {
      for (const name of failed) {
        migrate(['migrate', 'resolve', '--rolled-back', name], `file:${copy}`);
      }
      migrate(['migrate', 'deploy'], `file:${copy}`);
    } catch (err: any) {
      const output = cliOutput(err);
      return { outcome: 'failed', output, migration: failedMigrationIn(output) };
    }
    const missing = lacks(`file:${copy}`);
    return missing === null
      ? { outcome: 'worked' }
      : { outcome: 'incomplete', stage: 'after', missing };
  } finally {
    removeTrialFiles(copy);
  }
}

/** A migration's SQL, as `migrationShape` reads it; unreadable counts as all unseen. */
function shapeIn(migrationsDir: string): (name: string) => MigrationShape {
  const shapes = new Map<string, MigrationShape>();
  return (name) => {
    let shape = shapes.get(name);
    if (!shape) {
      try {
        shape = migrationShape(
          fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'),
        );
      } catch (err: any) {
        shape = { statements: 2, unseen: [`(its SQL could not be read: ${err?.message ?? err})`] };
      }
      shapes.set(name, shape);
    }
    return shape;
  };
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

  /**
   * `migrate diff` from a run of migrations (this release's copies of them, in
   * a scratch directory) to the tables, with `--exit-code` when asked.
   */
  const diffFromMigrations = (migrations: string[], exitCode: boolean): unknown => {
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
      return runSync(cmd, [...prefix, ...diff, schemaPath, ...(exitCode ? ['--exit-code'] : [])], {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        cwd: rootDir,
        stdio: 'pipe',
      });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  };

  // Would this run of migrations make exactly these tables?
  const tablesMatch = (migrations: string[]): boolean | null => {
    try {
      diffFromMigrations(migrations, true);
      return true;
    } catch (err: any) {
      if (err?.status === 2) return false;
      log.warn(
        `[DBMigrate] Could not compare the tables with the migration history: ${cliOutput(err)}`,
      );
      return null;
    }
  };

  // What a run of migrations makes that the tables lack (what was added to
  // them by hand aside); null when they lack nothing.
  const tablesLack = (migrations: string[]): string | null => {
    try {
      return schemaMissingIn(String(diffFromMigrations(migrations, false) ?? ''));
    } catch (err: any) {
      return `Xenon could not compare the tables with their migrations: ${cliOutput(err)}`;
    }
  };

  // What prisma/schema.prisma has that a database lacks; null when it lacks nothing.
  const lacksOfSchema = (url: string): string | null => {
    try {
      const summary = runSync(
        cmd,
        [...prefix, 'migrate', 'diff', '--from-schema-datamodel', schemaPath, '--to-url', url],
        { env: { ...process.env, DATABASE_URL: url }, cwd: rootDir, stdio: 'pipe' },
      );
      return schemaMissingIn(String(summary ?? ''));
    } catch (err: any) {
      return `Xenon could not compare the copy with prisma/schema.prisma: ${cliOutput(err)}`;
    }
  };

  const localMigrations = localMigrationsIn(migrationsDir);
  const shapeOf = shapeIn(migrationsDir);
  const plan = planSchemaSync(history, localMigrations, tablesMatch, shapeOf);
  const tryCopy = Boolean(
    history &&
    file &&
    plan.command === 'db push' &&
    (plan.basis === 'tables-differ' || plan.basis === 'failed-migration'),
  );
  const at: PrismaCommandLine = {
    prisma: [cmd, ...prefix].map(shellWord).join(' '),
    schema: schemaPath,
    databaseUrl: file ? `file:${file}` : databaseUrl,
    file,
    mode: file && fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : null,
    migrationsDir,
  };

  if (plan.command === 'none') {
    log.warn(`[DBMigrate] Not changing the database at ${where}: ${plan.reason}.`);
    throw new Error(schemaSyncFailure(plan, withoutStack(plan.unresolved?.logs ?? ''), at));
  }
  const how = tryCopy ? 'migrate deploy on a copy first, else db push' : plan.command;
  const announce = `[DBMigrate] Syncing database schema (${how}) at ${where}: ${plan.reason}.`;
  // A database with a history that leaves plain migrate deploy is worth a look.
  if (history && (plan.command === 'db push' || plan.basis === 'rebaselined')) log.warn(announce);
  else log.info(announce);

  /** What is known of the migration a P3018 names: whether running it again is safe. */
  const factsOfFailed = (output: string): FailedMigrationFacts | undefined => {
    const migration = failedMigrationIn(output);
    const index = migration ? localMigrations.indexOf(migration) : -1;
    if (!migration || index < 0) return undefined;
    const shape = shapeOf(migration);
    const wasThere = failedOnWhatWasThere(output);
    const shown = shape.unseen.length === 0;
    // One statement that failed did nothing. Several that only change what the
    // tables show did nothing if the tables are what the ones before it make.
    const leftNothing =
      !wasThere &&
      (shape.statements <= 1 || (shown && tablesMatch(localMigrations.slice(0, index)) === true));
    return { migration, wasThere, shown, leftNothing };
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
        log.info(`[DBMigrate] Recording ${name} as applied: the tables show all it does.`);
        prisma(['migrate', 'resolve', '--applied', name]);
      }
      step = undefined;
      prisma(['migrate', 'deploy']);
    } else {
      if (tryCopy && file && history) {
        // migrate deploy builds on what the recorded migrations made. On tables
        // that lack part of it (an index dropped by hand, a column an older
        // release's db push took away) it would leave the gap, or fill it
        // wrongly: SQLite reads a missing "column" in a redefined table's copy
        // as a string, so the column comes back holding its own name.
        const applied = new Set(history.applied);
        const lacking = tablesLack(localMigrations.filter((name) => applied.has(name)));
        let trial: CopyTrial;
        if (lacking !== null) {
          trial = { outcome: 'incomplete', stage: 'before', missing: lacking };
        } else {
          let size = '';
          try {
            size = `, ${megabytes(fs.statSync(file).size)} MB to copy, which can take a while`;
          } catch {
            /* the trial says why */
          }
          log.info(
            "[DBMigrate] Trying this version's migrations on a copy of the database first " +
              `(${path.basename(file)}${TRIAL_INFIX}${process.pid}, next to it${size}).`,
          );
          trial = await tryMigrationsOnCopy(file, plan.failed, prisma, lacksOfSchema, {
            copyDatabase: options.copyDatabase ?? copyWithVacuum,
            freeBytes: options.freeBytes ?? freeBytesIn,
          });
        }
        if (trial.outcome === 'worked') {
          log.info(
            "[DBMigrate] This version's migrations worked on the copy, and left it with " +
              'everything prisma/schema.prisma has, so Xenon runs prisma migrate deploy on the ' +
              'database.',
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
            : trial.outcome === 'incomplete' && trial.stage === 'before'
              ? '[DBMigrate] The tables lack part of what their recorded migrations make, so ' +
                "Xenon doesn't try this version's migrations on them and brings them up to " +
                `date with prisma db push:\n${trial.missing}`
              : trial.outcome === 'incomplete'
                ? "[DBMigrate] This version's migrations worked on the copy, but it still " +
                  "lacked part of this version's schema, so Xenon doesn't run them on the " +
                  `database and brings it up to date with prisma db push:\n${trial.missing}`
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
    const failed = !step && /P3018/.test(msg) ? factsOfFailed(msg) : undefined;
    throw new Error(schemaSyncFailure(ran, msg, at, { step, failed }));
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
