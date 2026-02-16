import * as fs from 'fs';
import * as path from 'path';
import log from '../logger';
import { config } from '../config';

/**
 * Prisma Schema Preparer
 *
 * Dynamically switches the database provider in schema.prisma
 * based on the XENON_DB_PROVIDER environment variable.
 */
export async function preparePrismaSchema() {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  const provider = config.databaseProvider; // defaults to sqlite

  if (!fs.existsSync(schemaPath)) {
    log.error(`[PrismaPrepare] Schema not found at ${schemaPath}`);
    return;
  }

  const schema = fs.readFileSync(schemaPath, 'utf8');
  const currentProviderMatch = schema.match(/datasource\s+db\s*{[\s\S]*?provider\s*=\s*"([^"]+)"/);
  const currentProvider = currentProviderMatch ? currentProviderMatch[1] : null;

  if (currentProvider === provider) {
    log.info(`[PrismaPrepare] Schema already configured for ${provider}`);
    return;
  }

  log.info(`[PrismaPrepare] Switching provider from ${currentProvider} to ${provider}`);

  // Replace the provider in the datasource block
  // We target the provider inside the 'datasource db' block specifically
  const newSchema = schema.replace(
    /(datasource\s+db\s*{[\s\S]*?provider\s*=\s*")([^"]*)(")/,
    `$1${provider}$3`,
  );

  fs.writeFileSync(schemaPath, newSchema);
  log.info('[PrismaPrepare] schema.prisma updated successfully.');
}

if (require.main === module) {
  preparePrismaSchema().catch((err) => {
    const msg = (err as any)?.message ?? String(err);
    log.error(`[PrismaPrepare] Critical failure: ${msg}`, err);
    process.exit(1);
  });
}
