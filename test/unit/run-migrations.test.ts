import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import {
  MigrationHistory,
  MigrationShape,
  migrationShape,
  planSchemaSync,
  runMigrations,
  schemaMissingIn,
  SchemaSyncOptions,
  warnOfUnmigratedSchemaChanges,
} from '../../src/scripts/run-migrations';
import { config } from '../../src/config';
import log from '../../src/logger';

describe('runMigrations', () => {
  afterEach(() => sinon.restore());

  it('skips with an info log when XENON_AUTO_MIGRATE=false (autoMigrate=false)', async () => {
    const orig = config.autoMigrate;
    config.autoMigrate = false;
    const info = sinon.spy(log, 'info');
    try {
      // Should resolve without throwing — and without invoking the prisma
      // binary at all. We assert via the log line we know is fixed copy.
      await runMigrations();
      const calls = info.getCalls().map((c) => c.args.join(' '));
      expect(calls.some((m) => /Auto-migrate disabled/i.test(m))).to.be.true;
      // It says how to choose the command, as the server would.
      const line = calls.find((m) => /Auto-migrate disabled/i.test(m)) ?? '';
      expect(line).to.match(/matches its tables/);
      expect(line).to.match(/P3018/);
    } finally {
      config.autoMigrate = orig;
      info.restore();
    }
  });
});

describe('planSchemaSync', () => {
  const LOCAL = ['20250101_a', '20250102_b', '20250103_c'];
  const unasked = () => {
    throw new Error('the tables only need comparing when a migration is left to apply');
  };

  it('pushes a database with no migration history, accepting data loss as the default always did', () => {
    const plan = planSchemaSync(null, LOCAL, unasked);
    expect(plan.command).to.equal('db push');
    expect(plan.acceptDataLoss).to.equal(true);
  });

  it('deploys to a database whose history has every migration', () => {
    const history = { applied: [...LOCAL], failed: [] };
    expect(planSchemaSync(history, LOCAL, unasked).command).to.equal('migrate deploy');
  });

  it('deploys the missing migrations when the tables are what the history says', () => {
    const history = { applied: LOCAL.slice(0, 2), failed: [] };
    const compared: string[][] = [];
    const plan = planSchemaSync(history, LOCAL, (applied) => {
      compared.push(applied);
      return true;
    });
    expect(plan.command).to.equal('migrate deploy');
    expect(compared).to.deep.equal([LOCAL.slice(0, 2)]);
  });

  it('pushes when the tables match no run of the migrations, so deploy would redo a change', () => {
    const history = { applied: LOCAL.slice(0, 1), failed: [] };
    const plan = planSchemaSync(history, LOCAL, () => false);
    expect(plan.command).to.equal('db push');
    expect(plan.acceptDataLoss).to.equal(false);
    expect(plan.reason).to.match(/differ from what its recorded migrations make/);
    // The failure message depends on why: see schemaSyncFailure.
    expect(plan.basis).to.equal('tables-differ');
    expect(plan.resolve).to.equal(undefined);
  });

  it('deploys, as the history says, when the tables could not be compared', () => {
    const history = { applied: LOCAL.slice(0, 1), failed: [] };
    const plan = planSchemaSync(history, LOCAL, () => null);
    expect(plan.command).to.equal('migrate deploy');
    expect(plan.reason).to.match(/could not be compared/);
  });

  it('pushes a database whose history records a failed migration and whose tables match no run of the migrations', () => {
    const history = { applied: LOCAL.slice(0, 2), failed: [LOCAL[2]] };
    const plan = planSchemaSync(history, LOCAL, () => false);
    expect(plan.command).to.equal('db push');
    expect(plan.acceptDataLoss).to.equal(false);
    expect(plan.reason).to.include(LOCAL[2]);
    expect(plan.basis).to.equal('failed-migration');
    expect(plan.failed).to.deep.equal([LOCAL[2]]);
  });

  // Re-baselining. db push writes no history, so a history behind its tables,
  // or one with a failed migration, stayed on db push for good: at the first
  // release whose migration drops a column or adds a unique index, db push
  // without --accept-data-loss refused it. When the tables are exactly what
  // the first k migrations make, the history can say so.
  describe('re-baselining', () => {
    const FOUR = [...LOCAL, '20250104_d'];

    it('records the migrations the tables already have, then deploys the rest', () => {
      const history = { applied: FOUR.slice(0, 1), failed: [] };
      const compared: number[] = [];
      const plan = planSchemaSync(history, FOUR, (migrations) => {
        compared.push(migrations.length);
        return migrations.length === 3;
      });
      expect(plan.command).to.equal('migrate deploy');
      expect(plan.basis).to.equal('rebaselined');
      expect(plan.resolve).to.deep.equal({ rolledBack: [], applied: FOUR.slice(1, 3) });
      expect(plan.reason).to.match(/first 3 migrations/);
      // The history first; then every migration (what db push leaves); then
      // down; then one below the match, which must not match too.
      expect(compared).to.deep.equal([1, 4, 3, 2]);
    });

    // Prisma's comparison sees tables, never rows: a backfill makes the same
    // tables as the migrations before it. Through #493 the largest k that
    // matched won, so the backfill was recorded as applied and never ran.
    it('runs a migration the comparison cannot see rather than record it', () => {
      const history = { applied: FOUR.slice(0, 2), failed: [] };
      const compared: number[] = [];
      const plan = planSchemaSync(history, FOUR, (migrations) => {
        compared.push(migrations.length);
        return migrations.length >= 3;
      });
      expect(plan.basis).to.equal('rebaselined');
      expect(plan.resolve).to.deep.equal({ rolledBack: [], applied: [FOUR[2]] });
      expect(plan.reason).to.match(/first 3 migrations/);
      expect(compared).to.deep.equal([2, 4, 3]);
    });

    const dup = 'Database error code: 1\n\nDatabase error:\nduplicate column name: path';
    const notNull =
      'Database error code: 1299\n\nDatabase error:\nNOT NULL constraint failed: Team.name';

    it('rolls a failed migration back first, and records it as applied when the tables have it', () => {
      const history = {
        applied: FOUR.slice(0, 2),
        failed: [FOUR[2]],
        failureLogs: { [FOUR[2]]: dup },
      };
      const plan = planSchemaSync(history, FOUR, (migrations) => migrations.length === 4);
      expect(plan.command).to.equal('migrate deploy');
      expect(plan.basis).to.equal('rebaselined');
      expect(plan.resolve).to.deep.equal({ rolledBack: [FOUR[2]], applied: FOUR.slice(2, 4) });
    });

    // The rows a migration failed on stay as they were until someone changes
    // them, and a migration can fail after its first statements ran. Through
    // #493 the start after such a failure recorded it as applied.
    it('leaves a failed migration alone when the tables have what it makes but it failed on the rows', () => {
      const history = {
        applied: FOUR.slice(0, 3),
        failed: [FOUR[3]],
        failureLogs: { [FOUR[3]]: notNull },
      };
      const plan = planSchemaSync(history, FOUR, (migrations) => migrations.length === 4);
      expect(plan.command).to.equal('none');
      expect(plan.basis).to.equal('failed-unresolved');
      expect(plan.resolve).to.equal(undefined);
      expect(plan.unresolved).to.deep.include({ migration: FOUR[3], why: 'part-way' });
      expect(plan.unresolved?.logs).to.include('NOT NULL');
    });

    it('leaves a failed migration alone when its record says nothing of why it failed', () => {
      const history = { applied: FOUR.slice(0, 3), failed: [FOUR[3]] };
      const plan = planSchemaSync(history, FOUR, (migrations) => migrations.length === 4);
      expect(plan.basis).to.equal('failed-unresolved');
    });

    const backfill: MigrationShape = { statements: 1, unseen: ['UPDATE "Team" SET "name" = ...'] };
    const twoBackfills: MigrationShape = {
      statements: 2,
      unseen: ['UPDATE "Team" SET "a" = 1', 'UPDATE "Team" SET "b" = 2'],
    };
    const shapes =
      (special: Record<string, MigrationShape>) =>
      (name: string): MigrationShape =>
        special[name] ?? { statements: 1, unseen: [] };

    it('rolls back a one-statement backfill that failed, so deploy runs it again', () => {
      const history = {
        applied: FOUR.slice(0, 3),
        failed: [FOUR[3]],
        failureLogs: { [FOUR[3]]: notNull },
      };
      const plan = planSchemaSync(
        history,
        FOUR,
        (migrations) => migrations.length >= 3,
        shapes({ [FOUR[3]]: backfill }),
      );
      expect(plan.basis).to.equal('rebaselined');
      expect(plan.resolve).to.deep.equal({ rolledBack: [FOUR[3]], applied: [] });
    });

    it("leaves a failed backfill of several statements alone: the tables can't show how far it got", () => {
      const history = {
        applied: FOUR.slice(0, 3),
        failed: [FOUR[3]],
        failureLogs: { [FOUR[3]]: notNull },
      };
      const plan = planSchemaSync(
        history,
        FOUR,
        (migrations) => migrations.length >= 3,
        shapes({ [FOUR[3]]: twoBackfills }),
      );
      expect(plan.command).to.equal('none');
      expect(plan.unresolved).to.deep.include({ migration: FOUR[3], why: 'part-way' });
    });

    it("never records a failed migration as applied when part of it is what the tables can't show", () => {
      const history = {
        applied: FOUR.slice(0, 3),
        failed: [FOUR[3]],
        failureLogs: { [FOUR[3]]: dup },
      };
      const plan = planSchemaSync(
        history,
        FOUR,
        (migrations) => migrations.length === 4,
        shapes({ [FOUR[3]]: { statements: 2, unseen: ['UPDATE "LocatorEtalon" ...'] } }),
      );
      expect(plan.command).to.equal('none');
      expect(plan.unresolved).to.deep.include({ migration: FOUR[3], why: 'unseen-part' });
    });

    it("keeps a database on db push when a migration it would record changes what the tables can't show", () => {
      const history = { applied: FOUR.slice(0, 1), failed: [] };
      const plan = planSchemaSync(
        history,
        FOUR,
        (migrations) => migrations.length === 3,
        shapes({ [FOUR[1]]: backfill }),
      );
      expect(plan.command).to.equal('db push');
      expect(plan.acceptDataLoss).to.equal(false);
      expect(plan.basis).to.equal('unrecordable');
      expect(plan.unseen).to.deep.equal([FOUR[1]]);
      expect(plan.resolve).to.equal(undefined);
    });

    it('leaves a failed migration of several statements alone when the tables match no run', () => {
      const history = { applied: FOUR.slice(0, 3), failed: [FOUR[3]] };
      const plan = planSchemaSync(history, FOUR, () => false, shapes({ [FOUR[3]]: twoBackfills }));
      expect(plan.command).to.equal('none');
      expect(plan.basis).to.equal('failed-unresolved');
    });

    it('rolls back a failed migration that left the tables as they were, so deploy runs it again', () => {
      const history = { applied: FOUR.slice(0, 2), failed: [FOUR[2]] };
      const compared: number[] = [];
      const plan = planSchemaSync(history, FOUR, (migrations) => {
        compared.push(migrations.length);
        return migrations.length === 2;
      });
      expect(plan.command).to.equal('migrate deploy');
      expect(plan.resolve).to.deep.equal({ rolledBack: [FOUR[2]], applied: [] });
      // Every migration first, then the history's own, before the rest.
      expect(compared).to.deep.equal([4, 2]);
    });

    it('never records fewer migrations than the history has', () => {
      const history = { applied: FOUR.slice(0, 3), failed: [] };
      const compared: number[] = [];
      planSchemaSync(history, FOUR, (migrations) => {
        compared.push(migrations.length);
        return false;
      });
      expect(Math.min(...compared)).to.equal(3);
    });

    it('stops looking when the tables cannot be compared', () => {
      const history = { applied: FOUR.slice(0, 1), failed: [] };
      const compared: number[] = [];
      const plan = planSchemaSync(history, FOUR, (migrations) => {
        compared.push(migrations.length);
        return migrations.length === 1 ? false : null;
      });
      expect(plan.command).to.equal('db push');
      expect(plan.basis).to.equal('tables-differ');
      expect(compared).to.deep.equal([1, 4]);
    });

    it('records a migration missing from the middle of the history when the tables have it', () => {
      const history = { applied: [FOUR[0], FOUR[2]], failed: [] };
      const plan = planSchemaSync(history, FOUR, (migrations) => migrations.length === 3);
      expect(plan.command).to.equal('migrate deploy');
      expect(plan.resolve).to.deep.equal({ rolledBack: [], applied: [FOUR[1]] });
    });

    // A history that names a migration this release doesn't have (another
    // branch's, or a later release's) is not this release's to rewrite.
    it('leaves a history that names a migration this release lacks as it is', () => {
      const history = { applied: [...LOCAL, '20990101_elsewhere'], failed: [] };
      const compared: number[] = [];
      const plan = planSchemaSync(history, FOUR, (migrations) => {
        compared.push(migrations.length);
        return false;
      });
      expect(plan.command).to.equal('db push');
      expect(plan.basis).to.equal('other-release');
      expect(plan.unknown).to.deep.equal(['20990101_elsewhere']);
      expect(plan.resolve).to.equal(undefined);
      expect(compared, 'only the history itself').to.deep.equal([3]);
    });
  });
});

describe('migrationShape', () => {
  it('counts what the tables show: tables, columns, indexes and the copy of a redefined table', () => {
    const shape = migrationShape(
      '-- RedefineTables\nPRAGMA defer_foreign_keys=ON;\nPRAGMA foreign_keys=OFF;\n' +
        'CREATE TABLE "new_Team" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL);\n' +
        'INSERT INTO "new_Team" ("id", "name") SELECT "id", "name" FROM "Team";\n' +
        'DROP TABLE "Team";\nALTER TABLE "new_Team" RENAME TO "Team";\n' +
        'CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");\n' +
        'CREATE INDEX "x" ON "Team"("name") WHERE "name" IS NOT NULL;\n' +
        'DROP INDEX "y";\nPRAGMA foreign_keys=ON;\n',
    );
    expect(shape).to.deep.equal({ statements: 7, unseen: [] });
  });

  it("finds what the tables can't show: rows, triggers, views, collations", () => {
    const shape = migrationShape(
      'UPDATE "Team" SET "name" = \'a; b\' || "name"; -- a comment; with a semicolon\n' +
        'INSERT INTO "TeamMember" ("teamId") SELECT "id" FROM "Team";\n' +
        'DELETE FROM "Log";\n' +
        'CREATE VIEW "v" AS SELECT 1;\n' +
        'CREATE TRIGGER "t" AFTER UPDATE ON "Team" BEGIN SELECT 1; END;\n' +
        'CREATE INDEX "c" ON "Team"("name" COLLATE NOCASE);\n' +
        '/* a block; comment */ INSERT INTO "new_Team" ("id") SELECT "id" FROM "Other";\n',
    );
    expect(shape.unseen).to.have.length(8);
    expect(shape.unseen[0]).to.match(/^UPDATE "Team" SET "name" = 'a; b'/);
    expect(shape.statements).to.equal(8);
  });
});

describe('schemaMissingIn', () => {
  it('finds nothing missing where the database only has more', () => {
    expect(schemaMissingIn('No difference detected.\n')).to.equal(null);
    expect(
      schemaMissingIn(
        '\n[+] Added tables\n  - LabNotes\n\n[*] Changed the `Team` table\n' +
          '  [+] Added column `labCol`\n  [+] Added index on columns (createdAt)\n',
      ),
    ).to.equal(null);
  });

  it('lists what the database lacks, with its table', () => {
    const missing = schemaMissingIn(
      '\n[+] Added tables\n  - LabNotes\n\n[*] Redefined table `LocatorEtalon`\n\n' +
        '[*] Changed the `SessionLog` table\n  [-] Removed index on columns (session_id, createdAt)\n' +
        '\n[*] Changed the `Team` table\n  [+] Added column `labCol`\n',
    );
    expect(missing).to.equal(
      '[*] Redefined table `LocatorEtalon`\n[*] Changed the `SessionLog` table\n' +
        '  [-] Removed index on columns (session_id, createdAt)',
    );
  });

  it("counts a line it doesn't know as missing", () => {
    expect(schemaMissingIn('Something new from Prisma')).to.equal('Something new from Prisma');
    expect(schemaMissingIn('[-] Removed tables\n  - Session')).to.equal(
      '[-] Removed tables\n  - Session',
    );
  });
});

describe('runMigrations chooses by the database, not by databaseProvider', () => {
  const scratchUrl = `file:${path.join(os.tmpdir(), `xenon-choose-${process.pid}-absent.db`)}`;
  const everyMigration = fs
    .readdirSync(path.resolve(__dirname, '../../prisma/migrations'))
    .filter((name) => !name.endsWith('.toml'));
  let saved: Pick<typeof config, 'autoMigrate' | 'databaseProvider' | 'databaseUrl'>;

  beforeEach(() => {
    saved = {
      autoMigrate: config.autoMigrate,
      databaseProvider: config.databaseProvider,
      databaseUrl: config.databaseUrl,
    };
    config.autoMigrate = true;
    config.databaseUrl = scratchUrl;
  });

  afterEach(() => {
    Object.assign(config, saved);
  });

  /** The prisma subcommand runMigrations ran, given the history the database reports. */
  async function commandFor(
    provider: 'sqlite' | 'postgresql',
    history: MigrationHistory | null,
  ): Promise<string> {
    config.databaseProvider = provider;
    const commands: string[] = [];
    await runMigrations(
      (_cmd, args) => {
        commands.push(args.filter((a) => !a.startsWith('-') && !a.includes(path.sep)).join(' '));
        return Buffer.from('ok');
      },
      async () => history,
    );
    return commands[commands.length - 1];
  }

  for (const provider of ['sqlite', 'postgresql'] as const) {
    it(`pushes a database with no history when databaseProvider is ${provider}`, async () => {
      expect(await commandFor(provider, null)).to.equal('db push');
    });

    it(`deploys to a database with a complete history when databaseProvider is ${provider}`, async () => {
      const history = { applied: everyMigration, failed: [] };
      expect(await commandFor(provider, history)).to.equal('migrate deploy');
    });
  }
});

// `db push --accept-data-loss` drops whatever the schema doesn't have. On a
// database with no history that is what the default always did. On one with a
// history it would drop what the history doesn't explain, such as a table added
// by hand or a half-finished table a failed migration left, where `migrate
// deploy` (the old `postgresql` path) kept them.
describe('runMigrations: what each plan runs', () => {
  const scratchUrl = `file:${path.join(os.tmpdir(), `xenon-flags-${process.pid}-absent.db`)}`;
  const everyMigration = fs
    .readdirSync(path.resolve(__dirname, '../../prisma/migrations'))
    .filter((name) => !name.endsWith('.toml'))
    .sort();
  let saved: Pick<typeof config, 'autoMigrate' | 'databaseUrl'>;

  beforeEach(() => {
    saved = { autoMigrate: config.autoMigrate, databaseUrl: config.databaseUrl };
    config.autoMigrate = true;
    config.databaseUrl = scratchUrl;
  });

  afterEach(() => {
    Object.assign(config, saved);
    sinon.restore();
  });

  type Step = (args: string[], databaseUrl: string) => unknown;

  /**
   * Every prisma call's arguments and database URL, answered by the given
   * steps: `diff` compares the tables with a run of migrations (`--exit-code`),
   * `lack` lists what the tables lack of the recorded migrations before a
   * copy, `check` what the copy lacks of the schema after the migrations,
   * `resolve` writes the history, and `update` is the rest. A summary step
   * left out finds nothing missing.
   */
  async function run(
    history: MigrationHistory | null,
    steps: { diff?: Step; lack?: Step; check?: Step; resolve?: Step; update?: Step } = {},
    options: SchemaSyncOptions = {},
  ): Promise<{ calls: string[][]; urls: string[]; error?: Error }> {
    const calls: string[][] = [];
    const urls: string[] = [];
    try {
      await runMigrations(
        (_cmd, args, opts) => {
          const url = String(opts.env.DATABASE_URL);
          calls.push(args);
          urls.push(url);
          if (args.includes('diff') && !args.includes('--exit-code')) {
            const summary = args.includes('--to-url') ? steps.check : steps.lack;
            return summary ? summary(args, url) : Buffer.from('No difference detected.\n');
          }
          const step = args.includes('diff')
            ? steps.diff
            : args.includes('resolve')
              ? steps.resolve
              : steps.update;
          return step ? step(args, url) : Buffer.from('ok');
        },
        async () => history,
        options,
      );
      return { calls, urls };
    } catch (error: any) {
      return { calls, urls, error };
    }
  }

  const fail =
    (status: number, stderr: string, stdout = '') =>
    () => {
      throw Object.assign(new Error('Command failed'), {
        status,
        stderr: Buffer.from(stderr),
        stdout: Buffer.from(stdout),
      });
    };

  const update = (calls: string[][]) => calls[calls.length - 1];
  /** The number of migrations a `migrate diff --from-migrations <dir>` call builds. */
  const migrationsIn = (args: string[]) =>
    fs.readdirSync(args[args.indexOf('--from-migrations') + 1]).filter((n) => !n.endsWith('.toml'))
      .length;
  /** A diff that finds the tables equal to the first `k` migrations, and only those. */
  const tablesAreFirst = (k: number) => (args: string[]) =>
    migrationsIn(args) === k ? Buffer.from('') : fail(2, '')();
  /** The prisma subcommands called, as words: `migrate resolve --applied x`. */
  const words = (calls: string[][]) =>
    calls.map((args) =>
      args
        .filter((a) => !a.includes(path.sep) && a !== '--schema' && a !== '--exit-code')
        .join(' '),
    );

  // What `db push` without --accept-data-loss prints when it would drop a table
  // that holds rows: the list on stdout, the refusal on stderr.
  const refusesDataLoss = fail(
    1,
    'Error: Use the --accept-data-loss flag to ignore the data loss warnings like prisma db push --accept-data-loss',
    '⚠️  There might be data loss when applying the changes:\n\n' +
      '  • You are about to drop the `LabNotes` table, which is not empty (1 rows).',
  );

  const root = path.resolve(__dirname, '../..');
  const prisma = path.join(root, 'node_modules', '.bin', 'prisma');
  const schema = path.join(root, 'prisma', 'schema.prisma');
  const scratchFile = scratchUrl.slice('file:'.length);
  /** The commands a failure message gives, one to an indented line, in its order. */
  const commandsIn = (message: string) =>
    message
      .split('\n')
      .filter((line) => /^ {2}(DATABASE_URL=|echo |touch )/.test(line))
      .map((line) => line.trim());
  const letGo =
    `DATABASE_URL=file:${scratchFile} ${prisma} db push --skip-generate --accept-data-loss ` +
    `--schema ${schema}`;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** One command: a backup, and once it is made, `letGo`. */
  const letGoAfterBackup = new RegExp(
    `^(touch \\S+ && chmod [0-7]{3} \\S+ && )?echo "VACUUM INTO '${escape(scratchFile)}\\.backup-` +
      `\\d{8}T\\d{9}Z'" \\| \\S+ db execute --url \\S+ --stdin && ${escape(letGo)}$`,
  );

  it('accepts data loss only for a database with no history, as the default always did', async () => {
    const { calls } = await run(null);
    expect(update(calls)).to.include.members(['db', 'push', '--accept-data-loss']);
  });

  it('pushes without accepting data loss when the tables match no run of the migrations', async () => {
    const history = { applied: everyMigration.slice(0, -1), failed: [] };
    const { calls } = await run(history, { diff: fail(2, '') });
    expect(update(calls)).to.include.members(['db', 'push']);
    expect(update(calls)).to.not.include('--accept-data-loss');
  });

  it('pushes without accepting data loss when the history records a failed migration and the tables match no run', async () => {
    const history = { applied: everyMigration.slice(0, -1), failed: everyMigration.slice(-1) };
    const { calls } = await run(history, { diff: fail(2, '') });
    expect(update(calls)).to.include.members(['db', 'push']);
    expect(update(calls)).to.not.include('--accept-data-loss');
  });

  it('deploys to a database whose history matches its tables', async () => {
    const history = { applied: everyMigration.slice(0, -1), failed: [] };
    const { calls } = await run(history);
    expect(update(calls)).to.include.members(['migrate', 'deploy']);
  });

  // The default setting's db push moved a migrate-deploy database's tables
  // past its history. Recording what they have puts it back on migrate deploy.
  it('records the migrations the tables already have, then deploys, without db push', async () => {
    const newest = everyMigration[everyMigration.length - 1];
    const history = { applied: everyMigration.slice(0, -1), failed: [] };
    const { calls, error } = await run(history, { diff: tablesAreFirst(everyMigration.length) });
    expect(error).to.equal(undefined);
    expect(words(calls).filter((w) => !w.startsWith('migrate diff'))).to.deep.equal([
      `migrate resolve --applied ${newest}`,
      'migrate deploy',
    ]);
  });

  it('rolls a failed migration back before recording it as applied', async () => {
    const newest = everyMigration[everyMigration.length - 1];
    const history = {
      applied: everyMigration.slice(0, -1),
      failed: [newest],
      failureLogs: { [newest]: 'Database error:\nduplicate column name: path' },
    };
    const { calls, error } = await run(history, { diff: tablesAreFirst(everyMigration.length) });
    expect(error).to.equal(undefined);
    expect(words(calls).filter((w) => !w.startsWith('migrate diff'))).to.deep.equal([
      `migrate resolve --rolled-back ${newest}`,
      `migrate resolve --applied ${newest}`,
      'migrate deploy',
    ]);
  });

  // The start after a migration failed on the rows: the history stays as it
  // is, nothing runs, and the message says how to finish or undo it.
  it('changes nothing, and says how to finish or undo it, for a failed migration it cannot resolve', async () => {
    const newest = everyMigration[everyMigration.length - 1];
    const history = {
      applied: everyMigration.slice(0, -1),
      failed: [newest],
      failureLogs: {
        [newest]:
          'Database error:\nNOT NULL constraint failed: Team.name\n\n   0: sql_schema_connector::apply',
      },
    };
    const { calls, error } = await run(history, { diff: tablesAreFirst(everyMigration.length) });
    expect(error, 'the start stops').to.be.an('Error');
    expect(words(calls).filter((w) => !w.startsWith('migrate diff'))).to.deep.equal([]);
    const message = error?.message ?? '';
    expect(message).to.include(newest);
    expect(message).to.match(/part of it may be in the tables/);
    expect(message).to.include('NOT NULL constraint failed: Team.name');
    expect(message, 'without the engine stack').to.not.include('sql_schema_connector');
    expect(message).to.include(path.join(root, 'prisma', 'migrations', newest, 'migration.sql'));
    const commands = commandsIn(message);
    expect(commands).to.include(
      `DATABASE_URL=file:${scratchFile} ${prisma} migrate resolve --applied ${newest} --schema ${schema}`,
    );
    expect(commands).to.include(
      `DATABASE_URL=file:${scratchFile} ${prisma} migrate resolve --rolled-back ${newest} --schema ${schema}`,
    );
  });

  describe('the copy', () => {
    const trialPrefix = `${path.basename(scratchFile)}.xenon-trial-`;
    const trialFiles = () =>
      fs.readdirSync(path.dirname(scratchFile)).filter((n) => n.startsWith(trialPrefix));

    beforeEach(() => {
      fs.writeFileSync(scratchFile, '');
    });

    afterEach(() => {
      fs.rmSync(scratchFile, { force: true });
      for (const name of trialFiles()) fs.rmSync(path.join(path.dirname(scratchFile), name));
    });

    /** A copier that makes the file it is asked for, and notes where. */
    function copier(made: string[]) {
      return async (_from: string, to: string) => {
        made.push(to);
        fs.writeFileSync(to, 'copy');
      };
    }

    const roomy = () => 1e12;

    it('runs migrate deploy on a copy next to the database first, then on the database', async () => {
      const made: string[] = [];
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      const { calls, urls, error } = await run(
        history,
        { diff: fail(2, '') },
        { copyDatabase: copier(made), freeBytes: roomy },
      );
      expect(error).to.equal(undefined);
      expect(made).to.have.length(1);
      expect(path.dirname(made[0])).to.equal(path.dirname(scratchFile));
      expect(path.basename(made[0])).to.equal(`${trialPrefix}${process.pid}`);
      const deploys = urls.filter((_, i) => calls[i].includes('deploy'));
      expect(deploys).to.deep.equal([`file:${made[0]}`, scratchUrl]);
      expect(
        calls.some((args) => args.includes('push')),
        'no db push',
      ).to.equal(false);
      expect(trialFiles(), 'the copy is deleted').to.deep.equal([]);
    });

    it('rolls a failed migration back on the copy first, and on the database only when the copy took the rest', async () => {
      const made: string[] = [];
      const newest = everyMigration[everyMigration.length - 1];
      const history = { applied: everyMigration.slice(0, -1), failed: [newest] };
      const { calls, urls, error } = await run(
        history,
        { diff: fail(2, '') },
        { copyDatabase: copier(made), freeBytes: roomy },
      );
      expect(error).to.equal(undefined);
      const steps = calls
        .map((args, i) => ({ word: words([args])[0], url: urls[i] }))
        .filter((c) => !c.word.startsWith('migrate diff'));
      expect(steps).to.deep.equal([
        { word: `migrate resolve --rolled-back ${newest}`, url: `file:${made[0]}` },
        { word: 'migrate deploy', url: `file:${made[0]}` },
        { word: `migrate resolve --rolled-back ${newest}`, url: scratchUrl },
        { word: 'migrate deploy', url: scratchUrl },
      ]);
    });

    it('falls back to db push without the flag when the copy fails, and never deploys to the database', async () => {
      const made: string[] = [];
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      const { calls, urls, error } = await run(
        history,
        {
          diff: fail(2, ''),
          update: (args, url) => {
            if (args.includes('deploy')) {
              return fail(
                1,
                'Error: P3018\n\nA migration failed to apply.\n\nMigration name: ' +
                  `${everyMigration[everyMigration.length - 1]}\n\nDatabase error:\nduplicate column name: path`,
              )();
            }
            expect(url).to.equal(scratchUrl);
            return refusesDataLoss();
          },
        },
        { copyDatabase: copier(made), freeBytes: roomy },
      );
      const deploys = urls.filter((_, i) => calls[i].includes('deploy'));
      expect(deploys).to.deep.equal([`file:${made[0]}`]);
      expect(update(calls)).to.include.members(['db', 'push']);
      expect(update(calls)).to.not.include('--accept-data-loss');
      expect(trialFiles()).to.deep.equal([]);

      const message = error?.message ?? '';
      expect(message).to.match(/stopped rather than delete/);
      expect(message).to.match(/failed on a copy/);
      expect(message, "the copy's own reason").to.include('duplicate column name: path');
      expect(message).to.include('LabNotes');
      const commands = commandsIn(message);
      expect(commands[0]).to.include(`VACUUM INTO '${scratchFile}.backup-`);
      expect(commands[0], 'let go only once backed up').to.match(letGoAfterBackup);
      expect(commands.filter((c) => c.includes('migrate deploy'))).to.deep.equal([]);
    });

    it("skips the copy when there isn't room for it next to the database", async () => {
      const made: string[] = [];
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      fs.writeFileSync(scratchFile, Buffer.alloc(1024 * 1024));
      const { calls, error } = await run(
        history,
        { diff: fail(2, ''), update: refusesDataLoss },
        { copyDatabase: copier(made), freeBytes: () => 1024 * 1024 },
      );
      expect(made, 'no copy').to.deep.equal([]);
      expect(calls.some((args) => args.includes('deploy'))).to.equal(false);
      expect(update(calls)).to.include.members(['db', 'push']);
      expect(error?.message).to.match(/room/);
      expect(error?.message).to.match(/MB/);
      expect(commandsIn(error?.message ?? '')[0]).to.match(letGoAfterBackup);
      expect(error?.message).to.include(
        `free ${Math.ceil((2 * 1024 * 1024 + 64 * 1024 * 1024) / (1024 * 1024))} MB`,
      );
    });

    it('skips the copy when the database is locked', async () => {
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      const { calls, error } = await run(
        history,
        { diff: fail(2, ''), update: refusesDataLoss },
        {
          copyDatabase: async () => {
            throw new Error('Raw query failed. Code: `5`. Message: `database is locked`');
          },
          freeBytes: roomy,
        },
      );
      expect(calls.some((args) => args.includes('deploy'))).to.equal(false);
      expect(update(calls)).to.include.members(['db', 'push']);
      expect(error?.message).to.match(/locked/);
      expect(error?.message).to.match(/another server/);
      expect(trialFiles()).to.deep.equal([]);
    });

    // migrate deploy builds on what the recorded migrations made. Through #493
    // a copy it worked on stood for the file, even where the tables lacked
    // part of that (an index dropped by hand, a column an older release's db
    // push took away), and the file then got a full history over the gap.
    it("doesn't try the copy when the tables lack part of what their recorded migrations make", async () => {
      const made: string[] = [];
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      const lacking =
        '[*] Changed the `SessionLog` table\n  [-] Removed index on columns (session_id, createdAt)';
      const { calls, error } = await run(
        history,
        {
          diff: fail(2, ''),
          lack: () => Buffer.from(`\n[+] Added tables\n  - LabNotes\n\n${lacking}\n`),
          update: refusesDataLoss,
        },
        { copyDatabase: copier(made), freeBytes: roomy },
      );
      expect(made, 'no copy').to.deep.equal([]);
      expect(calls.some((args) => args.includes('deploy'))).to.equal(false);
      expect(update(calls)).to.include.members(['db', 'push']);
      expect(update(calls)).to.not.include('--accept-data-loss');
      const message = error?.message ?? '';
      expect(message).to.match(
        /differ from what its recorded migrations make: they lack part of what those make/,
      );
      expect(message).to.include(lacking);
      expect(message).to.not.include('LabNotes\n  - ');
    });

    it('says both reasons when a database with a failed migration also lacks part of its migrations', async () => {
      const made: string[] = [];
      const newest = everyMigration[everyMigration.length - 1];
      const history = { applied: everyMigration.slice(0, -1), failed: [newest] };
      const { error } = await run(
        history,
        {
          diff: fail(2, ''),
          lack: () => Buffer.from('[*] Redefined table `LocatorEtalon`\n'),
          update: refusesDataLoss,
        },
        { copyDatabase: copier(made), freeBytes: roomy },
      );
      expect(made, 'no copy').to.deep.equal([]);
      const message = error?.message ?? '';
      expect(message).to.match(
        new RegExp(
          `records a failed migration \\(${newest}\\), which prisma migrate deploy won't run ` +
            'past, and its tables lack part of what its recorded migrations make',
        ),
      );
    });

    it("doesn't run the migrations on the database when the copy still lacks part of the schema", async () => {
      const made: string[] = [];
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      const { calls, urls, error } = await run(
        history,
        {
          diff: fail(2, ''),
          check: (args) => {
            expect(args).to.include('--from-schema-datamodel');
            return Buffer.from('\n[*] Redefined table `LocatorEtalon`\n');
          },
          update: (args) => (args.includes('deploy') ? Buffer.from('ok') : refusesDataLoss()),
        },
        { copyDatabase: copier(made), freeBytes: roomy },
      );
      const deploys = urls.filter((_, i) => calls[i].includes('deploy'));
      expect(deploys, 'the copy only').to.deep.equal([`file:${made[0]}`]);
      expect(update(calls)).to.include.members(['db', 'push']);
      expect(update(calls)).to.not.include('--accept-data-loss');
      const message = error?.message ?? '';
      expect(message).to.match(/a copy of it still lacked part of this version's schema/);
      expect(message).to.include('[*] Redefined table `LocatorEtalon`');
      expect(trialFiles()).to.deep.equal([]);
    });

    it("tries the copy when it can't tell how much space is free", async () => {
      const made: string[] = [];
      const info = sinon.spy(log, 'info');
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      const { error } = await run(
        history,
        { diff: fail(2, '') },
        { copyDatabase: copier(made), freeBytes: () => null },
      );
      expect(error).to.equal(undefined);
      expect(made).to.have.length(1);
      const lines = info.getCalls().map((c) => c.args.join(' '));
      expect(lines.some((l) => /could not tell how much space is free/.test(l))).to.equal(true);
    });

    it('says what is copied before it copies', async () => {
      const info = sinon.spy(log, 'info');
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      fs.writeFileSync(scratchFile, Buffer.alloc(3 * 1024 * 1024));
      let before = -1;
      await run(
        history,
        { diff: fail(2, '') },
        {
          copyDatabase: async (_from, to) => {
            before = info.callCount;
            fs.writeFileSync(to, 'copy');
          },
          freeBytes: roomy,
        },
      );
      const lines = info
        .getCalls()
        .slice(0, before)
        .map((c) => c.args.join(' '));
      expect(lines.some((l) => /3 MB to copy, which can take a while/.test(l))).to.equal(true);
    });

    it("gives the copy the database's own mode before any data is in it", async () => {
      fs.chmodSync(scratchFile, 0o640);
      let mode = -1;
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      await run(
        history,
        { diff: fail(2, '') },
        {
          copyDatabase: async (_from, to) => {
            mode = fs.statSync(to).mode & 0o777;
            fs.writeFileSync(to, 'copy');
          },
          freeBytes: roomy,
        },
      );
      expect(mode.toString(8)).to.equal('640');
    });

    it('says there was no room when the copy runs out of space', async () => {
      const history = { applied: everyMigration.slice(0, -1), failed: [] };
      const { error } = await run(
        history,
        { diff: fail(2, ''), update: refusesDataLoss },
        {
          copyDatabase: async () => {
            throw new Error('Raw query failed. Code: `13`. Message: `database or disk is full`');
          },
          freeBytes: () => null,
        },
      );
      expect(error?.message).to.match(/no room next to it for a copy/);
      expect(error?.message).to.match(/free \d+ MB next to the file/);
      expect(trialFiles()).to.deep.equal([]);
    });

    // A history that names a migration this release lacks is another
    // release's. Through #493 the copy ran this release's migrations on it,
    // and then the file did.
    it("doesn't try this release's migrations on a database from another release", async () => {
      const made: string[] = [];
      const history = {
        applied: [...everyMigration.slice(0, -1), '29980101000000_elsewhere'],
        failed: [],
      };
      const { calls, error } = await run(
        history,
        { diff: fail(2, ''), update: refusesDataLoss },
        { copyDatabase: copier(made), freeBytes: roomy },
      );
      expect(made, 'no copy').to.deep.equal([]);
      expect(calls.some((args) => args.includes('deploy') || args.includes('resolve'))).to.equal(
        false,
      );
      expect(update(calls)).to.include.members(['db', 'push']);
      expect(update(calls)).to.not.include('--accept-data-loss');
      expect(error?.message).to.match(/another release brought it up to date/);
      expect(error?.message).to.include('29980101000000_elsewhere');
    });

    // A start that died mid-trial leaves its copy. The next start removes it,
    // unless the process that made it is still running.
    it('removes a copy a previous start left, but not one a running start is using', async () => {
      const dir = path.dirname(scratchFile);
      const dead = path.join(dir, `${trialPrefix}999991`);
      const alive = path.join(dir, `${trialPrefix}999992`);
      const other = `${scratchFile}.backup-20261005T000000Z`;
      for (const f of [dead, `${dead}-journal`, alive, other]) fs.writeFileSync(f, 'x');
      // Signal 0 only asks whether a process is there; stubbed all the same.
      sinon.stub(process, 'kill').callsFake(((pid: number) => {
        if (pid === 999992) return true;
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      }) as any);
      try {
        await run({ applied: [...everyMigration], failed: [] });
        expect(trialFiles().sort()).to.deep.equal([path.basename(alive)]);
        expect(fs.existsSync(other)).to.equal(true);
      } finally {
        fs.rmSync(other, { force: true });
      }
    });
  });

  // With a failed migration recorded, `migrate deploy` stops at once (P3009),
  // whatever the tables hold, so the message never suggests it.
  it('names the failed migration and never suggests migrate deploy when the history records one', async () => {
    const failed = everyMigration[everyMigration.length - 1];
    const history = { applied: everyMigration.slice(0, -1), failed: [failed] };
    const { error } = await run(history, { diff: fail(2, ''), update: refusesDataLoss });
    expect(error, 'the start stops').to.be.an('Error');
    const message = error?.message ?? '';
    expect(message).to.match(/stopped rather than delete/);
    expect(message).to.include(failed);
    expect(message).to.match(/records a failed migration/);
    expect(message).to.include('LabNotes');

    const commands = commandsIn(message);
    expect(commands[0]).to.include(`VACUUM INTO '${scratchFile}.backup-`);
    expect(commands[0]).to.match(letGoAfterBackup);
    expect(commands.filter((c) => c.includes('migrate deploy'))).to.deep.equal([]);
    expect(message).to.not.match(/by hand with prisma migrate deploy/);
  });

  // A migration can fail on what is already in the tables, which a later
  // start deals with, or on the rows (a unique index over duplicate values),
  // which no start gets past until someone changes them. The message says
  // what the next start does for this migration, and nothing it doesn't.
  describe('when migrate deploy fails on a migration (P3018)', () => {
    const newest = everyMigration[everyMigration.length - 1];
    const failure = (name: string, error: string) =>
      fail(
        1,
        `Error: P3018\n\nA migration failed to apply.\n\nMigration name: ${name}\n\n` +
          `Database error:\n${error}`,
      );
    const history = { applied: everyMigration.slice(0, -1), failed: [] };

    it('promises the next start runs a one-statement migration that failed on the rows again', async () => {
      const { error } = await run(history, {
        diff: fail(1, 'simulated diff failure'),
        update: failure(newest, 'UNIQUE constraint failed: LocatorEtalon.strategy'),
      });
      const message = error?.message ?? '';
      expect(message).to.include(newest);
      expect(message).to.include('UNIQUE constraint failed');
      expect(message).to.match(/duplicate values/);
      expect(message).to.match(/change those rows, and start again: the next start runs it again/);
      expect(message).to.not.match(/next start brings the database up to date/);
    });

    it('says the next start records it when what it makes was already there', async () => {
      const { error } = await run(history, {
        diff: fail(1, 'simulated diff failure'),
        update: failure(newest, 'duplicate column name: path'),
      });
      const message = error?.message ?? '';
      expect(message).to.match(/because what it makes was already there/);
      expect(message).to.match(/records it as applied if the tables are what/);
      expect(message).to.not.match(/change those rows/);
    });

    it("promises nothing for a migration this release doesn't have", async () => {
      const { error } = await run(history, {
        diff: fail(1, 'simulated diff failure'),
        update: failure('20261101000000_uniq', 'UNIQUE constraint failed'),
      });
      const message = error?.message ?? '';
      expect(message).to.include('20261101000000_uniq');
      expect(message).to.not.match(/next start/);
    });
  });

  it("says it couldn't read the history without blaming the file outright", async () => {
    let error: Error | undefined;
    try {
      await runMigrations(
        () => Buffer.from('ok'),
        async () => {
          throw new Error('database is locked');
        },
      );
    } catch (e: any) {
      error = e;
    }
    expect(error?.message).to.match(/could not read the migration history/);
    expect(error?.message).to.match(/another server/);
    expect(error?.message).to.include('database is locked');
  });
});

// `npm run db:generate` runs `prisma migrate dev` on the developer's database,
// which gives it a migration history. From then on `npm run db:migrate` updates
// it with `migrate deploy`, so a schema.prisma edit with no migration never
// reaches it (or any server the release reaches), while the log said "in sync".
describe('npm run db:migrate: schema changes without a migration', () => {
  afterEach(() => sinon.restore());

  const failing = (status: number) => () => {
    throw Object.assign(new Error('Command failed'), {
      status,
      stderr: Buffer.from('boom'),
      stdout: Buffer.from(''),
    });
  };

  it('warns to run npm run db:generate when prisma/schema.prisma has changes no migration makes', () => {
    const warn = sinon.stub(log, 'warn');
    const calls: string[][] = [];
    const found = warnOfUnmigratedSchemaChanges((_cmd, args) => {
      calls.push(args);
      return failing(2)();
    });
    expect(found).to.equal(true);
    expect(calls).to.have.length(1);
    expect(calls[0]).to.include.members([
      'migrate',
      'diff',
      '--from-migrations',
      '--to-schema-datamodel',
      '--exit-code',
    ]);
    const lines = warn.getCalls().map((c) => c.args.join(' '));
    expect(lines).to.have.length(1);
    expect(lines[0]).to.match(/npm run db:generate/);
    expect(lines[0]).to.match(/migrate deploy/);
  });

  it('says nothing when the migrations make the schema', () => {
    const warn = sinon.stub(log, 'warn');
    expect(warnOfUnmigratedSchemaChanges(() => Buffer.from(''))).to.equal(false);
    expect(warn.called).to.equal(false);
  });

  it("doesn't stop when it can't tell", () => {
    sinon.stub(log, 'warn');
    expect(warnOfUnmigratedSchemaChanges(failing(1))).to.equal(null);
  });
});
