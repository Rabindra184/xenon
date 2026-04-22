import { execSync } from 'node:child_process';
import { config } from '../config';
import { preparePrismaSchema } from './prepare-prisma';
import log from '../logger';

const env = {
  ...process.env,
  DATABASE_URL: config.databaseUrl,
};

function executeCmd(cmd: string) {
  try {
    execSync(cmd, {
      env,
      stdio: 'inherit',
    });
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    log.error(`[DBInit] Failed to execute command: ${cmd} | Error: ${msg}`, error);
    throw error;
  }
}

async function main() {
  log.info(`[DBInit] Preparing database for provider: ${config.databaseProvider}`);

  // 1. Ensure schema matches provider
  await preparePrismaSchema();

  // 2. Handle Migrations
  if (config.databaseProvider === 'sqlite') {
    log.info('[DBInit] Syncing SQLite schema via db push...');
    executeCmd('npx prisma db push --accept-data-loss --skip-generate');
  } else {
    // For PostgreSQL, we might not have migrations checked in yet.
    // In "Cellular Architecture", we use db push to ensure the schema is synced
    // without requiring migration history sync across cells.
    log.info('[DBInit] Syncing PostgreSQL schema via db push...');
    executeCmd('npx prisma db push --accept-data-loss');
  }

  log.info('[DBInit] Generating Prisma Client...');
  executeCmd('npx prisma generate');
}

(async () => await main())();
