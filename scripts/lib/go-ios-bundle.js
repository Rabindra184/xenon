'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- a plain Node script, run without a build */

/**
 * The go-ios binary Xenon ships, taken from go-ios's npm release when Xenon is
 * built (scripts/fetch-go-ios.js), and checked before it is published.
 *
 * Xenon doesn't depend on the `go-ios` package: its install script copies
 * `ios` into npm's global bin, and its tarball holds every platform's build
 * (58 MB) for the one 44 MB file Xenon needs. So the build packs the pinned
 * release itself (npm checks the tarball's integrity, uses the developer's
 * registry and proxy, and runs none of its scripts), takes that one entry, and
 * keeps it only if its SHA-256 is the pin (src/scripts/goIosVersion.ts).
 *
 * `npm pack` and `tar` are run through `run`, handed in, so all of it is
 * tested without a network (test/unit/go-ios-bundle.spec.ts).
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ version: string, packageSpec: string, packageEntry: string, sha256: string }} GoIosPin
 * @typedef {(cmd: string, args: string[], opts: { cwd: string }) => string} RunFn
 *   Returns stdout; throws on a non-zero exit.
 */

/**
 * The pin, from the compiled lib/src/scripts/goIosVersion.js.
 *
 * @returns {GoIosPin}
 */
function pinFrom(goIosVersionModule) {
  return {
    version: goIosVersionModule.GO_IOS_VERSION,
    packageSpec: goIosVersionModule.GO_IOS_PACKAGE_SPEC,
    packageEntry: goIosVersionModule.GO_IOS_PACKAGE_ENTRY,
    sha256: goIosVersionModule.GO_IOS_SHA256,
  };
}

/**
 * @param {string} file
 * @returns {string | null} its SHA-256 in hex, or null when there is no file
 */
function sha256OfFile(file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** @type {RunFn} */
function defaultRun(cmd, args, opts) {
  return execFileSync(cmd, args, { cwd: opts.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// What a failed command said, in one line: the first line of its stderr, else
// of its message. execFileSync's message starts with "Command failed: <the
// command line>", which says nothing about why.
function firstLine(err) {
  const text = (err && (err.stderr || err.message)) || String(err);
  return (
    String(text)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || String(err)
  );
}

// Executable by everyone, as the fetch leaves it (0755) and as it must be
// installed: the server may run as another user than the one who built it.
function isExecutableMode(mode) {
  return (mode & 0o111) === 0o111;
}

/**
 * Put the pinned go-ios at `<vendorDir>/ios`, unless the one there is it.
 *
 * Fetched into a folder beside it, so the last step is one rename and a
 * failure leaves nothing behind.
 *
 * @param {{ pin: GoIosPin, vendorDir: string, rootDir: string, run: RunFn }} options
 * @returns {'kept' | 'fetched'}
 */
function fetchBundledGoIos({ pin, vendorDir, rootDir, run }) {
  const binary = path.join(vendorDir, 'ios');
  if (sha256OfFile(binary) === pin.sha256) return 'kept';

  fs.mkdirSync(vendorDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(vendorDir, '.fetch-'));
  try {
    let filename;
    try {
      const stdout = run('npm', ['pack', pin.packageSpec, '--pack-destination', tmp, '--json'], {
        cwd: rootDir,
      });
      filename = JSON.parse(stdout)[0].filename;
    } catch (err) {
      throw new Error(
        `go-ios: npm pack ${pin.packageSpec} failed (${firstLine(err)}). Check that npm can reach its registry.`,
      );
    }

    const extracted = path.join(tmp, pin.packageEntry);
    try {
      run('tar', ['-xzf', path.join(tmp, filename), '-C', tmp, pin.packageEntry], { cwd: rootDir });
    } catch {
      // tar exits non-zero when the tarball has no such entry; the check
      // below says so, naming the entry.
    }
    if (!fs.existsSync(extracted)) {
      throw new Error(
        `go-ios: ${pin.packageSpec} has no ${pin.packageEntry}. Check GO_IOS_PACKAGE_ENTRY in src/scripts/goIosVersion.ts.`,
      );
    }
    const actual = sha256OfFile(extracted);
    if (actual !== pin.sha256) {
      throw new Error(
        `go-ios: ${pin.packageEntry} in ${pin.packageSpec} has SHA-256 ${actual}, expected ${pin.sha256} (GO_IOS_SHA256).`,
      );
    }

    fs.chmodSync(extracted, 0o755);
    fs.renameSync(extracted, binary);
    return 'fetched';
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * What is wrong with the go-ios about to be published (lib/), if anything.
 *
 * @param {{ pin: GoIosPin, binaryPath: string }} options
 * @returns {string[]} problems, empty when it is fine
 */
function checkBundledGoIos({ pin, binaryPath }) {
  const actual = sha256OfFile(binaryPath);
  if (actual === null) return [`${binaryPath} is missing. Run npm run build.`];

  const problems = [];
  if (!isExecutableMode(fs.statSync(binaryPath).mode)) {
    problems.push(`${binaryPath} is not executable.`);
  }
  if (actual !== pin.sha256) {
    problems.push(`${binaryPath} has SHA-256 ${actual}, expected ${pin.sha256}.`);
  }
  return problems;
}

/**
 * Whether `npm pack` would publish go-ios, executable. npm's own listing is
 * what is judged, so an entry it lists without a mode fails.
 *
 * `--ignore-scripts` skips prepack and postpack. npm 10 runs Xenon's
 * `prepare` on a pack all the same (pacote 18 doesn't read the flag for it),
 * which regenerates the Prisma client as `npm run build` does. `npm pack` also
 * runs scripts in the foreground unless told otherwise, and prepare's output
 * would then come before the JSON on stdout: `--foreground-scripts=false`.
 *
 * @param {{ rootDir: string, entryPath: string, run: RunFn }} options
 * @returns {string[]} problems, empty when it is fine
 */
function checkPackedGoIos({ rootDir, entryPath, run }) {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts', '--foreground-scripts=false'];
  const stdout = run('npm', args, { cwd: rootDir });
  const files = JSON.parse(stdout)[0].files || [];
  const entry = files.find((file) => file.path === entryPath);
  if (!entry) return [`npm pack would not include ${entryPath}.`];
  if (typeof entry.mode !== 'number') return [`npm pack did not report the mode of ${entryPath}.`];
  if (!isExecutableMode(entry.mode)) {
    const octal = (entry.mode & 0o777).toString(8);
    return [`npm pack would include ${entryPath} with mode ${octal}, which is not executable.`];
  }
  return [];
}

module.exports = {
  pinFrom,
  sha256OfFile,
  fetchBundledGoIos,
  checkBundledGoIos,
  checkPackedGoIos,
  defaultRun,
};
