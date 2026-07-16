import { expect } from 'chai';
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
  let originalAutoMigrate: boolean;
  let originalProvider: 'sqlite' | 'postgresql';

  beforeEach(() => {
    originalAutoMigrate = config.autoMigrate;
    originalProvider = config.databaseProvider;
    config.autoMigrate = true;
    config.databaseProvider = 'sqlite';
  });

  afterEach(() => {
    config.autoMigrate = originalAutoMigrate;
    config.databaseProvider = originalProvider;
  });

  it('throws instead of swallowing when the schema sync fails', async () => {
    const prismaErr: any = new Error('Command failed');
    prismaErr.stderr = Buffer.from(
      'We found changes that cannot be executed:\n' +
        '  - Added the required column `userId` to the `ApiKey` table without a default value.',
    );
    const failingRunner = () => {
      throw prismaErr;
    };

    let thrown: Error | undefined;
    try {
      await runMigrations(failingRunner);
    } catch (e: any) {
      thrown = e;
    }

    expect(thrown, 'runMigrations must not swallow the failure').to.be.an('Error');
    // The message has to carry the real cause, not just "sync failed".
    expect(thrown!.message).to.match(/userId/);
    expect(thrown!.message).to.match(/ApiKey/);
  });

  it('names the database so the operator knows what to back up', async () => {
    const failingRunner = () => {
      throw Object.assign(new Error('Command failed'), { stderr: Buffer.from('boom') });
    };

    let thrown: Error | undefined;
    try {
      await runMigrations(failingRunner);
    } catch (e: any) {
      thrown = e;
    }

    expect(thrown).to.be.an('Error');
    expect(thrown!.message).to.match(/XENON_AUTO_MIGRATE/);
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
