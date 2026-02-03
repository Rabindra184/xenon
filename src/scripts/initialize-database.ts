import { execSync } from 'node:child_process';
import { config } from '../config';
import { preparePrismaSchema } from './prepare-prisma';

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
  } catch (error) {
    console.error(`Failed to execute command: ${cmd}`);
    throw error;
  }
}

async function main() {
  console.log(`[DBInit] Preparing database for provider: ${config.databaseProvider}`);

  // 1. Ensure schema matches provider
  await preparePrismaSchema();

  // 2. Handle Migrations
  if (config.databaseProvider === 'sqlite') {
    console.log('[DBInit] Deploying SQLite migrations...');
    executeCmd('npx prisma migrate deploy');
  } else {
    // For PostgreSQL, we might not have migrations checked in yet.
    // In "Cellular Architecture", we use db push to ensure the schema is synced
    // without requiring migration history sync across cells.
    console.log('[DBInit] Syncing PostgreSQL schema via db push...');
    executeCmd('npx prisma db push --accept-data-loss');
  }

  console.log('[DBInit] Generating Prisma Client...');
  executeCmd('npx prisma generate');
}

(async () => await main())();
