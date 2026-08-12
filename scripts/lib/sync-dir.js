'use strict';

/**
 * Authoritative directory sync for the generated Prisma client.
 *
 * `postinstall` regenerates the client inside the installed package and copies
 * it over the one the tarball shipped. The two are not the same size — the
 * embedded engine paths differ between a repo checkout and a package under
 * node_modules — so the copy always writes a different-length file over an
 * existing one.
 *
 * A plain per-file copy leaves whatever the new generation did not overwrite:
 * files the previous generation emitted and this one does not, and, if a write
 * is ever cut short, the tail of the longer file it replaced. That second case
 * is how an installed client came to hold a fragment of its own previous
 * version — `path.join(…)` on one line continued by a bare `.join(…)` on the
 * next, which is valid JavaScript, so it survived to fail at require() time
 * with "path.join(...).join is not a function" and the plugin simply did not
 * load.
 *
 * Replacing the destination outright removes the whole class: after a sync the
 * destination is exactly the source, with nothing inherited.
 */

const path = require('path');
const fs = require('fs');

/**
 * Copy `src` to `dest` so that `dest` afterwards contains exactly `src`.
 *
 * @param {string} src
 * @param {string} dest
 * @returns {number} count of files written
 */
function syncDirectory(src, dest) {
  if (!fs.existsSync(src)) return 0;

  // Remove first: `fs.cp`/`copyFile` overwrite per file and would leave
  // anything the new generation no longer emits.
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });

  return copyInto(src, dest);
}

function copyInto(src, dest) {
  let written = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      written += copyInto(from, to);
    } else {
      fs.copyFileSync(from, to);
      written += 1;
    }
  }
  return written;
}

/**
 * Confirm the generated client can actually be loaded.
 *
 * A corrupted client is syntactically valid JavaScript — the failure is a
 * TypeError at require() time — so parsing it proves nothing. The only honest
 * check is to load it, which is what the plugin does on startup anyway.
 *
 * @param {string} clientDir
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function verifyGeneratedClient(clientDir) {
  // Resolved, because `require` takes a relative path as relative to THIS
  // module while `fs.existsSync` takes it as relative to cwd. Left unresolved,
  // a relative caller gets "Cannot find module" for a file that is plainly
  // there, and the verdict says nothing about whether the client is sound.
  const entry = path.resolve(clientDir, 'index.js');
  if (!fs.existsSync(entry)) {
    return { ok: false, error: `${entry} does not exist` };
  }
  try {
    delete require.cache[require.resolve(entry)];
    require(entry);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { syncDirectory, verifyGeneratedClient };
