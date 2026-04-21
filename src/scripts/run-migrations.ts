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

export async function runMigrations(): Promise<void> {
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
    execFileSync(cmd, args, { env, cwd: rootDir, stdio: 'pipe' });
    log.info('[DBMigrate] Database schema in sync.');
  } catch (err: any) {
    const msg = err?.stderr?.toString() || err?.message || String(err);
    log.error(`[DBMigrate] Auto-sync failed: ${msg}`);
  }
}
