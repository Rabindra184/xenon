// Generates the launcher's tokens.css from the dashboard's palette so the two
// surfaces can't drift apart. Runs before dev/build, like sync-schema.
//
//   node scripts/sync-tokens.mjs          # write
//   node scripts/sync-tokens.mjs --check  # exit 1 on drift (CI)
//
// The launcher's palette is a *derived subset*: the same values plus --*-rgb
// channel triples Tailwind needs for opacity modifiers. web/src/tokens.css is
// the single source of truth.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTokensCss, parseCssVars } from './tokens-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const source = resolve(repoRoot, 'web', 'src', 'tokens.css');
const dest = resolve(here, '..', 'src', 'renderer', 'src', 'tokens.css');
const checkOnly = process.argv.includes('--check');

if (!existsSync(source)) {
  console.error(`[sync-tokens] source not found: ${source}`);
  process.exit(1);
}

let generated;
try {
  generated = generateTokensCss(parseCssVars(readFileSync(source, 'utf8')));
} catch (err) {
  console.error(`[sync-tokens] ${err.message}`);
  process.exit(1);
}

const current = existsSync(dest) ? readFileSync(dest, 'utf8') : null;

if (checkOnly) {
  if (current === generated) {
    console.log('[sync-tokens] tokens.css is in sync with the dashboard palette.');
    process.exit(0);
  }
  console.error(
    `[sync-tokens] drift detected: ${relative(repoRoot, dest)} does not match ${relative(repoRoot, source)}.\n` +
      `Run 'npm run sync:tokens' in mac-app/ and commit the result.`
  );
  process.exit(1);
}

if (current === generated) {
  console.log('[sync-tokens] tokens.css already up to date.');
} else {
  writeFileSync(dest, generated);
  console.log(`[sync-tokens] regenerated ${relative(repoRoot, dest)} from ${relative(repoRoot, source)}`);
}
