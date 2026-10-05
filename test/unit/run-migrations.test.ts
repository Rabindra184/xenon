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

  it('pushes a database with no migration history', () => {
    expect(planSchemaSync(null, LOCAL, unasked).command).to.equal('db push');
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
    expect(planSchemaSync(history, LOCAL, () => false).command).to.equal('db push');
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
    expect(plan.reason).to.include(LOCAL[2]);
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
