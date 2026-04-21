#!/usr/bin/env node
/**
 * Verifies that the committed Prisma client in src/generated/client
 * matches what would be produced by running `prisma generate` now.
 *
 * Strategy: snapshot the committed index.d.ts hash, run prisma generate
 * (which writes in place per schema.prisma's `output` directive),
 * compare the new hash. Restore original bytes regardless of result.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const committedIndex = path.join(rootDir, 'src/generated/client/index.d.ts');

if (!fs.existsSync(committedIndex)) {
  console.error('::error::src/generated/client/index.d.ts is missing. Run `npm run build`.');
  process.exit(1);
}

const originalBytes = fs.readFileSync(committedIndex);
const originalHash = crypto.createHash('sha256').update(originalBytes).digest('hex');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function restore() {
  fs.writeFileSync(committedIndex, originalBytes);
}

let newHash;
try {
  execFileSync(path.join(rootDir, 'node_modules/.bin/prisma'), ['generate'], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: 'file:/tmp/freshness-check.db' },
    stdio: 'pipe',
  });
  newHash = sha256(fs.readFileSync(committedIndex));
} catch (err) {
  restore();
  console.error('::error::prisma generate failed:', err.stderr?.toString() || err.message);
  process.exit(1);
}

// Always restore committed bytes so local checks don't muddy the working tree
restore();

if (originalHash !== newHash) {
  console.error(
    '::error::Generated Prisma client is stale. Run `npm run build` and commit src/generated/client.',
  );
  process.exit(1);
}

console.log('Generated client is fresh.');
