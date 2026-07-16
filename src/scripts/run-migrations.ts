import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import log from '../logger';
import { config } from '../config';

function resolvePluginRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const pkgJson = path.join(dir, 'package.json');
    const schema = path.join(dir, 'prisma', 'schema.prisma');
    if (fs.existsSync(pkgJson) && fs.existsSync(schema)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
        if (pkg.name === '@xenon-device-management/xenon' || pkg.name === 'xenon') {
          return dir;
        }
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '../../..');
}

function resolvePrismaInvocation(rootDir: string): { cmd: string; prefix: string[] } {
  const localBin = path.resolve(rootDir, 'node_modules/.bin/prisma');
  if (fs.existsSync(localBin)) return { cmd: localBin, prefix: [] };
  return { cmd: 'npx', prefix: ['prisma'] };
}

/**
 * Runs the prisma CLI. Injectable so tests can drive the failure path without
 * shelling out — `node:child_process` exports are non-configurable, so they
 * can't be stubbed in place.
 */
export type SchemaSyncRunner = (
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; stdio: 'pipe' },
) => unknown;

export async function runMigrations(
  runSync: SchemaSyncRunner = execFileSync as SchemaSyncRunner,
): Promise<void> {
  if (!config.autoMigrate) {
    log.info(
      '[DBMigrate] Auto-migrate disabled by XENON_AUTO_MIGRATE=false. ' +
        'Apply schema changes externally (`prisma migrate deploy` for ' +
        'PostgreSQL, `prisma db push` for SQLite) before the hub boots.',
    );
    return;
  }

  const rootDir = resolvePluginRoot();
  const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
  const migrationsDir = path.join(rootDir, 'prisma', 'migrations');

  if (!fs.existsSync(schemaPath) || !fs.existsSync(migrationsDir)) {
    log.warn(`[DBMigrate] Skipping auto-migrate: schema or migrations missing at ${rootDir}`);
    return;
  }

  const dbDir = path.dirname(
    config.databasePath || path.join(os.homedir(), '.cache', 'xenon', 'xenon.db'),
  );
  fs.mkdirSync(dbDir, { recursive: true });

  const { cmd, prefix } = resolvePrismaInvocation(rootDir);
  const env = { ...process.env, DATABASE_URL: config.databaseUrl };
  const isSqlite = config.databaseProvider === 'sqlite';
  const args = isSqlite
    ? [...prefix, 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', schemaPath]
    : [...prefix, 'migrate', 'deploy', '--schema', schemaPath];
  try {
    log.info(
      `[DBMigrate] Syncing database schema (${config.databaseProvider}, ${isSqlite ? 'db push' : 'migrate deploy'})...`,
    );
    runSync(cmd, args, { env, cwd: rootDir, stdio: 'pipe' });
    log.info('[DBMigrate] Database schema in sync.');
  } catch (err: any) {
    const msg = (err?.stderr?.toString() || err?.message || String(err)).trim();
    log.error(`[DBMigrate] Auto-sync failed: ${msg}`);
    // Boot must not continue. The schema is not what the code expects, so the
    // next query fails somewhere unrelated — `prisma.user.count()` reporting a
    // missing User table, say — and buries this, the actual cause. Stop here
    // and hand back something the operator can act on.
    throw new Error(
      `[DBMigrate] Cannot start: database schema sync failed for ${config.databaseProvider}.\n` +
        `${msg}\n\n` +
        `Database: ${config.databaseUrl}\n` +
        `A required column cannot be added to a table that already has rows. ` +
        `Back up the database above, then either migrate it by hand or start ` +
        `from a fresh one. To boot without touching the schema (the schema must ` +
        `already match), set XENON_AUTO_MIGRATE=false.`,
    );
  }
}
