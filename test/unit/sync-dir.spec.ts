import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { syncDirectory, verifyGeneratedClient } = require('../../scripts/lib/sync-dir');

/**
 * `postinstall` regenerates the Prisma client inside the installed package and
 * copies it over the one the tarball shipped. The two differ in size — the
 * embedded engine paths differ between a repo checkout and a package under
 * node_modules — so this copy always writes a different-length file over an
 * existing one, and anything it does not overwrite survives.
 *
 * An installed client was found holding a fragment of its own previous
 * version: `path.join(…)` on one line continued by a bare `.join(…)` on the
 * next. That is valid JavaScript, so nothing caught it until require() failed
 * with "path.join(...).join is not a function" and the plugin silently did not
 * load.
 */
describe('generated client sync', () => {
  let root: string;
  let src: string;
  let dest: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-sync-'));
    src = path.join(root, 'src');
    dest = path.join(root, 'dest');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('leaves the destination holding exactly the source', () => {
    fs.writeFileSync(path.join(src, 'index.js'), 'new');
    fs.mkdirSync(path.join(src, 'runtime'));
    fs.writeFileSync(path.join(src, 'runtime', 'library.js'), 'lib');

    syncDirectory(src, dest);

    expect(fs.readFileSync(path.join(dest, 'index.js'), 'utf8')).to.equal('new');
    expect(fs.readFileSync(path.join(dest, 'runtime', 'library.js'), 'utf8')).to.equal('lib');
  });

  it('removes a file the new generation no longer emits', () => {
    fs.writeFileSync(path.join(src, 'index.js'), 'new');
    fs.writeFileSync(path.join(dest, 'index.js'), 'old');
    fs.writeFileSync(path.join(dest, 'libquery_engine-old-target.node'), 'stale engine');

    syncDirectory(src, dest);

    expect(fs.existsSync(path.join(dest, 'libquery_engine-old-target.node'))).to.equal(false);
  });

  it('cannot leave a longer previous version behind a shorter new one', () => {
    // The shape of the real corruption: the destination was longer than its
    // replacement, and what survived was the tail.
    fs.writeFileSync(path.join(src, 'index.js'), 'path.join(a)\n');
    fs.writeFileSync(path.join(dest, 'index.js'), 'path.join(a)\n.join(b) // leftover tail\n');

    syncDirectory(src, dest);

    const after = fs.readFileSync(path.join(dest, 'index.js'), 'utf8');
    expect(after).to.equal('path.join(a)\n');
    expect(after).to.not.contain('leftover tail');
  });

  it('copies into a destination that does not exist yet', () => {
    fs.writeFileSync(path.join(src, 'index.js'), 'new');
    const fresh = path.join(root, 'fresh');
    expect(syncDirectory(src, fresh)).to.equal(1);
    expect(fs.readFileSync(path.join(fresh, 'index.js'), 'utf8')).to.equal('new');
  });

  it('does nothing when there is no source to sync', () => {
    expect(syncDirectory(path.join(root, 'missing'), dest)).to.equal(0);
  });
});

describe('generated client verification', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-verify-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('accepts a client that loads', () => {
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { PrismaClient: class {} };');
    expect(verifyGeneratedClient(dir)).to.deep.equal({ ok: true });
  });

  it('rejects the corruption that actually shipped', () => {
    // Syntactically valid — which is exactly why nothing caught it — and a
    // TypeError the moment it is required.
    fs.writeFileSync(
      path.join(dir, 'index.js'),
      'const path = require("path");\npath.join("a", "b")\n.join("c", "d")\n',
    );
    const verdict = verifyGeneratedClient(dir);
    expect(verdict.ok).to.equal(false);
    expect(verdict.error).to.contain('join is not a function');
  });

  it('rejects a client that is not there at all', () => {
    const verdict = verifyGeneratedClient(dir);
    expect(verdict.ok).to.equal(false);
    expect(verdict.error).to.contain('does not exist');
  });

  it('judges a relative path by the client, not by module resolution', () => {
    // `require` reads a relative path as relative to sync-dir.js while
    // `existsSync` reads it as relative to cwd. Unresolved, a relative caller
    // gets "Cannot find module" for a file that is plainly there — a verdict
    // that says nothing about the client.
    const rel = path.relative(process.cwd(), dir);
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { PrismaClient: class {} };');
    expect(verifyGeneratedClient(rel)).to.deep.equal({ ok: true });
  });
});
