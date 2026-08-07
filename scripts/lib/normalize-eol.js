'use strict';

/**
 * Line-ending normalization for the committed Prisma client.
 *
 * @prisma/client ships a few runtime *.d.ts files with CRLF, so `prisma
 * generate` rewrites them CRLF while the repo commits them LF (core.autocrlf
 * normalized them on the original `git add`). That mismatch produces perpetual
 * empty-diff working-tree churn and makes check-client-freshness.js compare
 * unequal bytes. generate-prisma.js normalizes generated text to LF after
 * generation; check-client-freshness.js normalizes text before hashing so the
 * freshness comparison is EOL-insensitive. Both share these helpers.
 */

const path = require('path');
const fs = require('fs');

// Extensions Prisma emits as text. The native query-engine binaries
// (…dylib.node / …so.node) are deliberately excluded and never touched.
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.prisma',
  '.map',
  '.md',
]);

/**
 * @param {string} filename A path or basename.
 * @returns {boolean} true if the file is generated text safe to normalize.
 */
function isNormalizableTextFile(filename) {
  const base = path.basename(filename);
  if (base.endsWith('.node')) return false; // native query-engine binary
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

/**
 * Byte-level CRLF -> LF: drop a CR (0x0D) only when immediately followed by LF
 * (0x0A). Lone CRs and every other byte (including multibyte UTF-8) are
 * preserved, so the transform is safe for any text encoding.
 *
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
function stripCrlfToLf(buffer) {
  const out = Buffer.allocUnsafe(buffer.length);
  let j = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) continue;
    out[j++] = buffer[i];
  }
  return out.subarray(0, j);
}

/**
 * Recursively rewrite every normalizable text file under `dir` to LF, in place.
 * Files already LF are left untouched (no needless writes). Binaries are skipped.
 *
 * @param {string} dir
 * @returns {number} count of files rewritten
 */
function normalizeDirToLf(dir) {
  let rewritten = 0;
  if (!fs.existsSync(dir)) return rewritten;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewritten += normalizeDirToLf(full);
    } else if (entry.isFile() && isNormalizableTextFile(entry.name)) {
      const original = fs.readFileSync(full);
      const normalized = stripCrlfToLf(original);
      if (!normalized.equals(original)) {
        fs.writeFileSync(full, normalized);
        rewritten += 1;
      }
    }
  }
  return rewritten;
}

module.exports = { isNormalizableTextFile, stripCrlfToLf, normalizeDirToLf };
