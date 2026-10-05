import { expect } from 'chai';
import os from 'os';
import path from 'path';
import { runMigrations } from '../../src/scripts/run-migrations';
import { config } from '../../src/config';

/**
 * A failed schema sync used to be logged and swallowed, so boot carried on into
 * an unrelated crash — `prisma.user.count()` reporting "table main.User does not
 * exist", which names the wrong table and hides the real cause. Upgrading a
 * populated SQLite DB hits exactly this: `db push` cannot add a required column
 * to a table that has rows, so the operator ends up debugging the wrong thing.
 *
 * runMigrations must fail fast, and say what actually happened.
 */
describe('runMigrations failure handling', () => {
  // runMigrations reads the database before it chooses a command. A file that
  // isn't there has no history and is never opened, so nothing here reaches
  // the server's own database.
  const scratchFile = path.join(os.tmpdir(), `xenon-fail-fast-${process.pid}-absent.db`);
  let originalAutoMigrate: boolean;
  let originalUrl: string;

  beforeEach(() => {
    originalAutoMigrate = config.autoMigrate;
    originalUrl = config.databaseUrl;
    config.autoMigrate = true;
    config.databaseUrl = `file:${scratchFile}`;
  });

  afterEach(() => {
    config.autoMigrate = originalAutoMigrate;
    config.databaseUrl = originalUrl;
  });

  async function failureOf(stderr: string): Promise<Error> {
    const failingRunner = () => {
      throw Object.assign(new Error('Command failed'), { stderr: Buffer.from(stderr) });
    };
    try {
      await runMigrations(failingRunner);
    } catch (e: any) {
      return e;
    }
    throw new Error('runMigrations must not swallow the failure');
  }

  it('throws instead of swallowing when the schema sync fails', async () => {
    const thrown = await failureOf(
      'We found changes that cannot be executed:\n' +
        '  - Added the required column `userId` to the `ApiKey` table without a default value.',
    );

    expect(thrown).to.be.an('Error');
    // The message has to carry the real cause, not just "sync failed".
    expect(thrown.message).to.match(/userId/);
    expect(thrown.message).to.match(/ApiKey/);
    expect(thrown.message).to.match(/adds a required column to a table that already has rows/);
  });

  it('names the database so the operator knows what to back up', async () => {
    const thrown = await failureOf('boom');

    expect(thrown).to.be.an('Error');
    expect(thrown.message).to.include(scratchFile);
    expect(thrown.message).to.match(/XENON_AUTO_MIGRATE/);
  });

  // Through 2.15.0 every failure was put down to a required column, P3005
  // ("The database schema is not empty") included.
  it("doesn't blame a required column when that isn't the cause", async () => {
    const thrown = await failureOf(
      'Error: P3005\n\nThe database schema is not empty. Read more about how to baseline an ' +
        'existing production database: https://pris.ly/d/migrate-baseline',
    );

    expect(thrown.message).to.not.match(/required column/i);
    expect(thrown.message).to.match(/P3005/);
    expect(thrown.message).to.match(/could not bring the database at .* up to date/);
  });

  it('resolves normally when the schema sync succeeds', async () => {
    let called = false;
    await runMigrations(() => {
      called = true;
      return Buffer.from('ok');
    });
    expect(called).to.be.true;
  });

  it('does not invoke the runner when autoMigrate is off', async () => {
    config.autoMigrate = false;
    let called = false;
    await runMigrations(() => {
      called = true;
      return Buffer.from('ok');
    });
    expect(called).to.be.false;
  });
});
