import { execSync } from 'node:child_process';
import { config } from '../config';
import log from '../logger';
import { assertSupportedDatabase } from './database-check';
import { syncDatabaseSchema } from './run-migrations';

/**
 * `npm run db:migrate`: bring the database up to date, then regenerate the
 * client.
 *
 * It checks the database URL and uses the rule the server uses at startup
 * (database-check.ts, then run-migrations.ts): the database decides between
 * `migrate deploy` and `db push`, so a database whose migration history
 * matches its tables stays on `migrate deploy`. It runs whatever
 * XENON_AUTO_MIGRATE says, since it is how you update the schema when that is
 * off. Through 2.15.0 it always ran `db push`, and first rewrote
 * prisma/schema.prisma's provider to `databaseProvider`. With `postgresql`,
 * that left a PostgreSQL schema in the checkout that the SQLite file couldn't
 * use.
 */
async function main() {
  // A PostgreSQL URL would otherwise reach the history read and fail there,
  // under a message about the file.
  assertSupportedDatabase();
  await syncDatabaseSchema();

  log.info('[DBInit] Generating Prisma Client...');
  execSync('npx prisma generate', {
    env: { ...process.env, DATABASE_URL: config.databaseUrl },
    stdio: 'inherit',
  });
}

main().catch((err: any) => {
  log.error(`[DBInit] ${err?.message ?? err}`);
  process.exit(1);
});
