// Writes the files that come from the repository itself, so they never drift
// from it: the configuration reference (from schema.json), the release notes
// (from CHANGELOG.md) and the API reference's OpenAPI document (from
// openapi.json, with the plugin's current version filled in). Runs before
// `start` and `build`, or by hand with `npm run generate`. Cloudflare Pages
// builds from the whole repository, so reading files one level above website/
// works there too.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderConfiguration } from './lib/configuration.mjs';
import { withVersion } from './lib/openapi.mjs';
import { renderReleaseNotes } from './lib/releaseNotes.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const websiteRoot = path.join(repoRoot, 'website');

function write(relativePath, content) {
  const target = path.join(websiteRoot, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`generated ${relativePath}`);
}

const schema = JSON.parse(readFileSync(path.join(repoRoot, 'schema.json'), 'utf8'));
write('docs/configuration.md', renderConfiguration(schema));

const changelog = readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
write('docs/release-notes.md', renderReleaseNotes(changelog));

// website/openapi.json is exported from the server's spec without a version
// (`npm run build:openapi` at the repository root). The site serves it from
// static/ with the current one, which is the plugin's own.
const { version } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const openapi = readFileSync(path.join(websiteRoot, 'openapi.json'), 'utf8');
write('static/openapi.json', withVersion(openapi, version));
