import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { MigrationHistory, planSchemaSync, runMigrations } from '../../src/scripts/run-migrations';
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

  it('pushes when the tables are ahead of the history, so deploy would redo a change', () => {
    const history = { applied: LOCAL.slice(0, 1), failed: [] };
    const plan = planSchemaSync(history, LOCAL, () => false);
    expect(plan.command).to.equal('db push');
    expect(plan.acceptDataLoss).to.equal(false);
    expect(plan.reason).to.match(/differ from what its recorded migrations make/);
    // The failure message depends on why: see schemaSyncFailure.
    expect(plan.basis).to.equal('tables-differ');
  });

  it('deploys, as the history says, when the tables could not be compared', () => {
    const history = { applied: LOCAL.slice(0, 1), failed: [] };
    const plan = planSchemaSync(history, LOCAL, () => null);
    expect(plan.command).to.equal('migrate deploy');
    expect(plan.reason).to.match(/could not be compared/);
  });

  it('pushes a database whose history records a failed migration', () => {
    const history = { applied: LOCAL.slice(0, 2), failed: [LOCAL[2]] };
    const plan = planSchemaSync(history, LOCAL, unasked);
    expect(plan.command).to.equal('db push');
    expect(plan.acceptDataLoss).to.equal(false);
    expect(plan.reason).to.include(LOCAL[2]);
    expect(plan.basis).to.equal('failed-migration');
    expect(plan.failed).to.deep.equal([LOCAL[2]]);
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

  type Step = (args: string[]) => unknown;

  /** Every prisma call's arguments, with `diff` and the update answered by the given steps. */
  async function run(
    history: MigrationHistory | null,
    steps: { diff?: Step; update?: Step } = {},
  ): Promise<{ calls: string[][]; error?: Error }> {
    const calls: string[][] = [];
    try {
      await runMigrations(
        (_cmd, args) => {
          calls.push(args);
          const step = args.includes('diff') ? steps.diff : steps.update;
          return step ? step(args) : Buffer.from('ok');
        },
        async () => history,
      );
      return { calls };
    } catch (error: any) {
      return { calls, error };
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

  it('accepts data loss only for a database with no history, as the default always did', async () => {
    const { calls } = await run(null);
    expect(update(calls)).to.include.members(['db', 'push', '--accept-data-loss']);
  });

  it('pushes without accepting data loss when the tables differ from the history', async () => {
    const history = { applied: everyMigration.slice(0, -1), failed: [] };
    const { calls } = await run(history, { diff: fail(2, '') });
    expect(update(calls)).to.include.members(['db', 'push']);
    expect(update(calls)).to.not.include('--accept-data-loss');
  });

  it('pushes without accepting data loss when the history records a failed migration', async () => {
    const history = { applied: everyMigration.slice(0, -1), failed: everyMigration.slice(-1) };
    const { calls } = await run(history);
    expect(update(calls)).to.include.members(['db', 'push']);
    expect(update(calls)).to.not.include('--accept-data-loss');
  });

  it('deploys to a database whose history matches its tables', async () => {
    const history = { applied: everyMigration.slice(0, -1), failed: [] };
    const { calls } = await run(history);
    expect(update(calls)).to.include.members(['migrate', 'deploy']);
  });

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
      .filter((line) => /^ {2}(DATABASE_URL=|echo )/.test(line))
      .map((line) => line.trim());
  const letGo =
    `DATABASE_URL=file:${scratchFile} ${prisma} db push --skip-generate --accept-data-loss ` +
    `--schema ${schema}`;

  // A history database whose tables differ from its migrations: `migrate
  // deploy` works on it when something was added by hand, and fails (P3018)
  // when db push moved the tables past the history. The message can't tell
  // which, so it never sends migrate deploy to the file before a copy.
  it('says how to let go of what db push would delete, or keep it by trying migrate deploy on a copy first', async () => {
    const history = { applied: everyMigration.slice(0, -1), failed: [] };
    const { error } = await run(history, { diff: fail(2, ''), update: refusesDataLoss });
    expect(error, 'the start stops').to.be.an('Error');
    const message = error?.message ?? '';
    expect(message).to.match(/stopped rather than delete/);
    expect(message).to.match(/differ from what its recorded migrations make/);
    // Prisma's own list of what it would drop, which is only on stdout.
    expect(message).to.include('LabNotes');
    expect(message).to.not.match(/required column/);
    expect(message, 'no plain advice to migrate deploy the file').to.not.match(
      /by hand with prisma migrate deploy/,
    );

    const commands = commandsIn(message);
    const backup = commands.findIndex(
      (c) =>
        c.includes(`VACUUM INTO '${scratchFile}.backup-`) &&
        c.endsWith(`| ${prisma} db execute --url file:${scratchFile} --stdin`),
    );
    expect(backup, `a backup first:\n${message}`).to.equal(0);
    expect(commands).to.include(letGo);

    const onCopy = commands.findIndex((c) =>
      c.startsWith(
        `DATABASE_URL=file:${scratchFile}.copy ${prisma} migrate deploy --schema ${schema}`,
      ),
    );
    const copied = commands.findIndex((c) => c.includes(`VACUUM INTO '${scratchFile}.copy'`));
    const onFile = commands.indexOf(
      `DATABASE_URL=file:${scratchFile} ${prisma} migrate deploy --schema ${schema}`,
    );
    expect(copied, 'the copy is made').to.be.greaterThan(backup);
    expect(onCopy, 'migrate deploy runs on the copy').to.be.greaterThan(copied);
    expect(onFile, 'and on the file only after the copy').to.be.greaterThan(onCopy);
  });

  // With a failed migration recorded, `migrate deploy` stops at once (P3009),
  // whatever the tables hold, so the message never suggests it.
  it('names the failed migration and never suggests migrate deploy when the history records one', async () => {
    const failed = everyMigration[everyMigration.length - 1];
    const history = { applied: everyMigration.slice(0, -1), failed: [failed] };
    const { error } = await run(history, { update: refusesDataLoss });
    expect(error, 'the start stops').to.be.an('Error');
    const message = error?.message ?? '';
    expect(message).to.match(/stopped rather than delete/);
    expect(message).to.include(failed);
    expect(message).to.match(/records a failed migration/);
    expect(message).to.not.match(/differ from what its recorded migrations make/);
    expect(message).to.include('LabNotes');

    const commands = commandsIn(message);
    expect(commands[0]).to.include(`VACUUM INTO '${scratchFile}.backup-`);
    expect(commands).to.include(letGo);
    expect(commands.filter((c) => c.includes('migrate deploy'))).to.deep.equal([]);
    expect(message).to.not.match(/by hand with prisma migrate deploy/);
  });

  // A migration can fail on what is already in the tables, which a later
  // start deals with, or on the rows (a unique index over duplicate values),
  // which no start gets past until someone changes them.
  it('says what to check when migrate deploy fails on a migration (P3018), without promising the next start recovers', async () => {
    const history = { applied: everyMigration.slice(0, -1), failed: [] };
    const { error } = await run(history, {
      diff: fail(1, 'simulated diff failure'),
      update: fail(
        1,
        'Error: P3018\n\nA migration failed to apply.\n\nMigration name: 20261101000000_uniq\n\n' +
          'Database error:\nUNIQUE constraint failed: LocatorEtalon.strategy, LocatorEtalon.nodeName',
      ),
    });
    expect(error, 'the start stops').to.be.an('Error');
    const message = error?.message ?? '';
    expect(message).to.include('20261101000000_uniq');
    expect(message).to.include('UNIQUE constraint failed');
    expect(message).to.not.match(/next start brings the database up to date/);
    expect(message).to.not.match(/start again, or first/);
    // Both things to check: a change already there, and rows the migration can't take.
    expect(message).to.match(/already there/);
    expect(message).to.match(/duplicate values/);
    expect(message).to.match(/change those rows/);
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
