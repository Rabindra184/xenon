import * as fs from 'node:fs';
import * as path from 'node:path';
import log from '../logger';
import { config } from '../config';

/**
 * Which database a server may start on.
 *
 * The plugin's database client is generated for one provider (SQLite in the
 * published plugin: prisma/schema.prisma and its migration history), and it
 * can talk only to a database of that kind, whatever `databaseProvider` says.
 * Through 2.13.1 nothing compared the two: `databaseProvider: postgresql` with
 * a SQLite file URL quietly ran on SQLite (what a Xenon Control profile set to
 * postgresql did), and a postgres URL stopped the server with Prisma's "the URL
 * must start with the protocol `file:`" under an unrelated hint.
 *
 * So the URL decides. It must match the client: a mismatch refuses to start,
 * with a sentence that says why. A `databaseProvider` that disagrees with the
 * client only earns a warning, because the URL is what is used. Its value
 * changes nothing else: the device store takes either value to mean Prisma,
 * and the startup schema step asks the database itself how to bring it up to
 * date (run-migrations.ts). Through 2.14 that step still took `postgresql` to
 * mean `migrate deploy`, which stopped the server on any database the default
 * setting had made.
 */

export type DatabaseProvider = 'sqlite' | 'postgresql';

const LABEL: Record<DatabaseProvider, string> = { sqlite: 'SQLite', postgresql: 'PostgreSQL' };

function providerOfUrl(url: string): DatabaseProvider | null {
  if (url.startsWith('file:')) return 'sqlite';
  if (/^postgres(ql)?:\/\//.test(url)) return 'postgresql';
  return null;
}

/** The datasource provider in a Prisma schema's text, or null if it has none. */
export function clientProviderFromSchema(schema: string): string | null {
  const match = /datasource\s+\w+\s*{[^}]*?provider\s*=\s*"([^"]+)"/.exec(schema);
  return match ? match[1] : null;
}

/** A database URL fit for a log line: a SQLite file's path, or a server URL without credentials. */
export function describeDatabaseUrl(url: string): string {
  if (url.startsWith('file:')) return url.slice('file:'.length);
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split(':')[0] + ':';
  }
}

/**
 * Decide whether the server may start on `url`. Throws an Error whose message
 * says what to change; returns a warning when `configured` disagrees with the
 * client but the URL is usable.
 */
export function checkDatabase(opts: { configured: string; url: string; client: string }): {
  warning?: string;
} {
  const { configured, url, client } = opts;
  const clientLabel = LABEL[client as DatabaseProvider] ?? client;
  const urlProvider = providerOfUrl(url);
  const where = describeDatabaseUrl(url);

  if (urlProvider !== client) {
    const kind = urlProvider
      ? `a ${LABEL[urlProvider]} database`
      : 'not a database this install knows';
    const fix =
      client === 'sqlite'
        ? 'Set DATABASE_URL (or databaseUrl) to a SQLite file, `file:/path/to/xenon.db`, or leave it ' +
          'unset to use the default under ~/.cache/xenon. The published plugin stores its data in SQLite only.'
        : `Set DATABASE_URL (or databaseUrl) to a ${clientLabel} URL.`;
    throw new Error(
      `[Database] Cannot start: the database URL (${where}) is ${kind}, but this install's ` +
        `database client is built for ${clientLabel}. ${fix}`,
    );
  }

  if (configured && configured !== client) {
    return {
      warning:
        `[Database] databaseProvider is "${configured}", which has no effect: this install ` +
        `stores its data in ${clientLabel}, in ${where}, and the database itself decides how ` +
        `its schema is brought up to date. Remove the setting, or set it to "${client}".`,
    };
  }
  return {};
}

/** The provider the generated client next to this file was built for. */
function generatedClientProvider(): string {
  const schemaPath = path.join(__dirname, '..', 'generated', 'client', 'schema.prisma');
  try {
    return clientProviderFromSchema(fs.readFileSync(schemaPath, 'utf8')) ?? 'sqlite';
  } catch {
    // The published plugin's client is SQLite; a missing copy means a plain install.
    return 'sqlite';
  }
}

/** Startup gate: log the warning, or throw so the server doesn't start on the wrong database. */
export function assertSupportedDatabase(): void {
  const { warning } = checkDatabase({
    configured: config.databaseProvider,
    url: config.databaseUrl,
    client: generatedClientProvider(),
  });
  if (warning) log.warn(warning);
}
