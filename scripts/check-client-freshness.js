#!/usr/bin/env node
/**
 * Verifies that the committed Prisma client in src/generated/client matches
 * what `prisma generate` from current schema.prisma would produce. Fails CI
 * when the developer edited the schema but forgot to run `npm run build`.
 *
 * Strategy: snapshot the entire src/generated/client directory into memory,
 * run prisma generate (which overwrites files in place per schema.prisma's
 * `output` directive), compute a stable hash over all files, compare, and
 * ALWAYS restore the snapshot — including on SIGINT/SIGTERM — so neither CI
 * nor local runs leave the working tree dirty.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isNormalizableTextFile, stripCrlfToLf } = require('./lib/normalize-eol');

const rootDir = path.resolve(__dirname, '..');
const clientDir = path.join(rootDir, 'src/generated/client');

if (!fs.existsSync(clientDir)) {
  console.error('::error::src/generated/client is missing. Run `npm run build`.');
  process.exit(1);
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function snapshot(dir) {
  const files = walkFiles(dir);
  return files.map((f) => ({ path: f, bytes: fs.readFileSync(f) }));
}

function restoreSnapshot(snap, dir) {
  // Remove any files that exist now but weren't in snapshot
  const snapPaths = new Set(snap.map((e) => e.path));
  for (const f of walkFiles(dir)) {
    if (!snapPaths.has(f)) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
  for (const { path: p, bytes } of snap) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  }
}

function hashDir(dir) {
  const h = crypto.createHash('sha256');
  for (const f of walkFiles(dir)) {
    h.update(path.relative(dir, f));
    h.update('\0');
    // Hash generated text EOL-insensitively: @prisma/client ships some runtime
    // *.d.ts with CRLF, so a raw `prisma generate` here would otherwise read as
    // "stale" against the LF-committed client. Binaries are hashed verbatim.
    const bytes = fs.readFileSync(f);
    h.update(isNormalizableTextFile(f) ? stripCrlfToLf(bytes) : bytes);
    h.update('\0');
  }
  return h.digest('hex');
}

const snap = snapshot(clientDir);
const originalHash = hashDir(clientDir);

let restored = false;
function restoreOnce() {
  if (restored) return;
  restored = true;
  try { restoreSnapshot(snap, clientDir); } catch (err) {
    console.error('::error::Failed to restore client dir snapshot:', err.message);
  }
}

process.on('exit', restoreOnce);
process.on('SIGINT', () => { restoreOnce(); process.exit(130); });
process.on('SIGTERM', () => { restoreOnce(); process.exit(143); });
process.on('uncaughtException', (err) => {
  restoreOnce();
  console.error('::error::uncaught:', err.message);
  process.exit(1);
});

let newHash;
try {
  execFileSync(path.join(rootDir, 'node_modules/.bin/prisma'), ['generate'], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: 'file:/tmp/freshness-check.db' },
    stdio: 'pipe',
  });
  newHash = hashDir(clientDir);
} catch (err) {
  restoreOnce();
  console.error('::error::prisma generate failed:', err.stderr?.toString() || err.message);
  process.exit(1);
}

restoreOnce();

if (originalHash !== newHash) {
  console.error(
    '::error::Generated Prisma client is stale. Run `npm run build` and commit src/generated/client.',
  );
  process.exit(1);
}

console.log('Generated client is fresh.');
