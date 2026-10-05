import { execSync } from 'node:child_process';
import { config } from '../config';
import log from '../logger';
import { syncDatabaseSchema } from './run-migrations';

/**
 * `npm run db:migrate`: bring the database up to date, then regenerate the
 * client.
 *
 * It uses the rule the server uses at startup (run-migrations.ts): the
 * database decides between `migrate deploy` and `db push`, so a database with
 * a migration history stays on `migrate deploy`. It runs whatever
 * XENON_AUTO_MIGRATE says, since it is how you update the schema when that is
 * off. Through 2.14 it always ran `db push`, and first rewrote
 * prisma/schema.prisma's provider to `databaseProvider`. With `postgresql`,
 * that left a PostgreSQL schema in the checkout that the SQLite file couldn't
 * use.
 */
async function main() {
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
