// Generates the launcher's tokens.css from the dashboard's design tokens so the
// two surfaces can't drift apart. Runs before dev/build, like sync-schema.
//
//   node scripts/sync-tokens.mjs          # write
//   node scripts/sync-tokens.mjs --check  # exit 1 on drift (CI)
//
// The launcher gets both themes (dark, and light under :root[data-theme='light'])
// with the same values, plus --*-rgb channel triples Tailwind needs for opacity
// modifiers. It also writes src/shared/windowBackground.ts, each theme's --bg
// for the main process's window. web/src/tokens.css is the single source of truth.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTokensCss, generateWindowBackgroundTs, parseThemeBlocks } from './tokens-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const source = resolve(repoRoot, 'web', 'src', 'tokens.css');
const checkOnly = process.argv.includes('--check');

if (!existsSync(source)) {
  console.error(`[sync-tokens] source not found: ${source}`);
  process.exit(1);
}

let outputs;
try {
  const themes = parseThemeBlocks(readFileSync(source, 'utf8'));
  outputs = [
    { dest: resolve(here, '..', 'src', 'renderer', 'src', 'tokens.css'), generated: generateTokensCss(themes) },
    { dest: resolve(here, '..', 'src', 'shared', 'windowBackground.ts'), generated: generateWindowBackgroundTs(themes) }
  ];
} catch (err) {
  console.error(`[sync-tokens] ${err.message}`);
  process.exit(1);
}

const stale = outputs.filter(({ dest, generated }) => (existsSync(dest) ? readFileSync(dest, 'utf8') : null) !== generated);

if (checkOnly) {
  if (stale.length === 0) {
    console.log('[sync-tokens] tokens.css and windowBackground.ts are in sync with the dashboard tokens.');
    process.exit(0);
  }
  for (const { dest } of stale) {
    console.error(`[sync-tokens] drift detected: ${relative(repoRoot, dest)} does not match ${relative(repoRoot, source)}.`);
  }
  console.error(`Run 'npm run sync:tokens' in mac-app/ and commit the result.`);
  process.exit(1);
}

if (stale.length === 0) {
  console.log('[sync-tokens] tokens.css and windowBackground.ts already up to date.');
}
for (const { dest, generated } of stale) {
  writeFileSync(dest, generated);
  console.log(`[sync-tokens] regenerated ${relative(repoRoot, dest)} from ${relative(repoRoot, source)}`);
}
