// Copies the canonical schema.json from the repo root into the app's bundled
// resources so the settings form is always generated from an in-sync snapshot.
// Runs before dev/build. The plugin's schema.json is the single source of truth.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '..', '..', 'schema.json');
const destDir = resolve(here, '..', 'resources');
const dest = resolve(destDir, 'schema.json');

if (!existsSync(source)) {
  console.error(`[sync-schema] source not found: ${source}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);

// Also emit a tiny provenance file so the app can display which schema it was built against.
let version = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(resolve(here, '..', '..', 'package.json'), 'utf8'));
  version = pkg.version ?? 'unknown';
} catch {
  /* ignore */
}
writeFileSync(
  resolve(destDir, 'schema-meta.json'),
  JSON.stringify({ pluginVersion: version, syncedFrom: 'repo:schema.json' }, null, 2)
);

console.log(`[sync-schema] copied schema.json (plugin ${version}) -> ${dest}`);
