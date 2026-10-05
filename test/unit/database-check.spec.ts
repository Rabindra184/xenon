import { expect } from 'chai';
import sinon from 'sinon';
import { config } from '../../src/config';
import log from '../../src/logger';
import {
  assertSupportedDatabase,
  checkDatabase,
  clientProviderFromSchema,
  describeDatabaseUrl,
} from '../../src/scripts/database-check';

// The published plugin ships a database client generated for SQLite. Through
// 2.13.1, `databaseProvider: postgresql` with a SQLite file URL quietly ran on
// SQLite (Xenon Control profiles did exactly this), and a postgres URL stopped
// the server with Prisma's "the URL must start with the protocol `file:`" under
// a hint about adding a column to a table with rows.
describe('checkDatabase', () => {
  const sqliteFile = 'file:/Users/me/.cache/xenon/xenon.db';
  const postgresUrl = 'postgresql://xenon:s3cret@db.example.com:5432/xenon';

  it('accepts a SQLite file with a SQLite client and says nothing', () => {
    expect(
      checkDatabase({ configured: 'sqlite', url: sqliteFile, client: 'sqlite' }),
    ).to.deep.equal({});
  });

  it('runs a SQLite file on a SQLite client when configured for postgresql, with a warning', () => {
    const { warning } = checkDatabase({
      configured: 'postgresql',
      url: sqliteFile,
      client: 'sqlite',
    });
    expect(warning).to.be.a('string');
    expect(warning).to.match(/databaseProvider/);
    expect(warning).to.match(/has no effect/);
    expect(warning).to.match(/SQLite/);
    expect(warning).to.include('/Users/me/.cache/xenon/xenon.db');
  });

  it('refuses a postgres URL when the client is built for SQLite, without printing the password', () => {
    expect(() => checkDatabase({ configured: 'postgresql', url: postgresUrl, client: 'sqlite' }))
      .to.throw(/SQLite/)
      .with.property('message')
      .that.does.not.include('s3cret');
  });

  it('refuses a postgres URL even when databaseProvider says sqlite', () => {
    expect(() =>
      checkDatabase({ configured: 'sqlite', url: postgresUrl, client: 'sqlite' }),
    ).to.throw(/db\.example\.com/);
  });

  it('accepts a postgres URL when the client was generated for PostgreSQL', () => {
    expect(
      checkDatabase({ configured: 'postgresql', url: postgresUrl, client: 'postgresql' }),
    ).to.deep.equal({});
  });

  it('refuses a SQLite file when the client was generated for PostgreSQL', () => {
    expect(() =>
      checkDatabase({ configured: 'postgresql', url: sqliteFile, client: 'postgresql' }),
    ).to.throw(/PostgreSQL/);
  });

  it('refuses a URL it cannot place', () => {
    expect(() =>
      checkDatabase({ configured: 'sqlite', url: 'mysql://h/db', client: 'sqlite' }),
    ).to.throw(/mysql:/);
  });
});

describe('clientProviderFromSchema', () => {
  it("reads the datasource's provider, not the generator's", () => {
    const schema = [
      'generator client {',
      '  provider      = "prisma-client-js"',
      '}',
      '',
      'datasource db {',
      '  provider = "postgresql"',
      '  url      = env("DATABASE_URL")',
      '}',
    ].join('\n');
    expect(clientProviderFromSchema(schema)).to.equal('postgresql');
  });

  it('returns null when there is no datasource', () => {
    expect(clientProviderFromSchema('generator client {}')).to.equal(null);
  });
});

describe('describeDatabaseUrl', () => {
  it('keeps a SQLite path and drops credentials from a server URL', () => {
    expect(describeDatabaseUrl('file:/data/xenon.db')).to.equal('/data/xenon.db');
    expect(describeDatabaseUrl('postgresql://u:p@h:5432/db?schema=x')).to.equal(
      'postgresql://h:5432/db',
    );
  });
});

describe('assertSupportedDatabase', () => {
  let saved: { provider: typeof config.databaseProvider; url: string };

  beforeEach(() => {
    saved = { provider: config.databaseProvider, url: config.databaseUrl };
  });

  afterEach(() => {
    config.databaseProvider = saved.provider;
    config.databaseUrl = saved.url;
    sinon.restore();
  });

  // These read the generated client this repo ships (src/generated/client),
  // which is built for SQLite.
  it('stops a server whose URL is a postgres database', () => {
    config.databaseProvider = 'postgresql';
    config.databaseUrl = 'postgresql://xenon:pw@127.0.0.1:5432/xenon';
    expect(() => assertSupportedDatabase()).to.throw(/built for SQLite/);
  });

  it('starts a postgresql-labelled server on its SQLite file, and says so once', () => {
    const warn = sinon.stub(log, 'warn');
    config.databaseProvider = 'postgresql';
    config.databaseUrl = 'file:/tmp/xenon-check.db';
    assertSupportedDatabase();
    expect(warn.callCount).to.equal(1);
    expect(String(warn.firstCall.args[0])).to.include('/tmp/xenon-check.db');
  });

  it('is silent for the default SQLite setup', () => {
    const warn = sinon.stub(log, 'warn');
    config.databaseProvider = 'sqlite';
    config.databaseUrl = 'file:/tmp/xenon-check.db';
    assertSupportedDatabase();
    expect(warn.called).to.equal(false);
  });
});
