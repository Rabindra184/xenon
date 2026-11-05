import { expect } from 'chai';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import pkg from '../../package.json';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const goIosBundle = require('../../scripts/lib/go-ios-bundle');
const { pinFrom, sha256OfFile, fetchBundledGoIos, checkBundledGoIos, checkPackedGoIos } =
  goIosBundle;

// The build takes go-ios out of its npm release's tarball and ships it in
// lib/. `npm pack` and `tar` are handed in, so none of this needs a network:
// the fake below answers `npm pack` with a tarball's name (and writes an empty
// file of that name where it was told to), and `tar` by writing the one entry
// it was asked for into the folder it was given.

const CONTENT = Buffer.from('fake go-ios');
const SHA = crypto.createHash('sha256').update(CONTENT).digest('hex');
const pin = {
  version: 'v1.2.1',
  packageSpec: 'go-ios@1.2.1',
  packageEntry: 'package/dist/go-ios-darwin-arm64_darwin_arm64/ios',
  sha256: SHA,
};

interface RunCall {
  cmd: string;
  args: string[];
  opts: { cwd: string };
}

function fakeRun({
  content,
  omitEntry = false,
  noTarball = false,
}: {
  content: Buffer;
  omitEntry?: boolean;
  /** As `npm pack` under `npm publish --dry-run`: it names a tarball it never writes. */
  noTarball?: boolean;
}) {
  const calls: RunCall[] = [];
  const run = (cmd: string, args: string[], opts: { cwd: string }) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'npm') {
      const destination = args[args.indexOf('--pack-destination') + 1];
      if (!noTarball) fs.writeFileSync(path.join(destination, 'go-ios-1.2.1.tgz'), '');
      return JSON.stringify([{ filename: 'go-ios-1.2.1.tgz' }]);
    }
    if (cmd === 'tar') {
      if (!omitEntry) {
        const dir = args[args.indexOf('-C') + 1];
        const entry = args[args.length - 1];
        fs.mkdirSync(path.dirname(path.join(dir, entry)), { recursive: true });
        fs.writeFileSync(path.join(dir, entry), content);
      }
      return '';
    }
    throw new Error(`unexpected command ${cmd}`);
  };
  return { run, calls };
}

describe('the bundled go-ios (build)', () => {
  let vendorDir: string;

  beforeEach(() => {
    vendorDir = fs.mkdtempSync(os.tmpdir() + '/go-ios-bundle-');
  });

  afterEach(() => fs.rmSync(vendorDir, { recursive: true, force: true }));

  it('maps the compiled pin module', () => {
    expect(
      pinFrom({
        GO_IOS_VERSION: 'v1',
        GO_IOS_PACKAGE_SPEC: 's',
        GO_IOS_PACKAGE_ENTRY: 'e',
        GO_IOS_SHA256: 'h',
      }),
    ).to.deep.equal({ version: 'v1', packageSpec: 's', packageEntry: 'e', sha256: 'h' });
  });

  // A lib/ compiled before the pin had all four fields gave `npm pack undefined`.
  it('names the first field a stale compiled pin module lacks', () => {
    expect(() => pinFrom({})).to.throw(
      'go-ios: lib/src/scripts/goIosVersion.js has no GO_IOS_VERSION. Run tsc -b first.',
    );
    expect(() => pinFrom({ GO_IOS_VERSION: 'v1.2.1' })).to.throw(
      'go-ios: lib/src/scripts/goIosVersion.js has no GO_IOS_PACKAGE_SPEC. Run tsc -b first.',
    );
    expect(() =>
      pinFrom({ GO_IOS_VERSION: 'v1', GO_IOS_PACKAGE_SPEC: 's', GO_IOS_PACKAGE_ENTRY: 'e' }),
    ).to.throw('go-ios: lib/src/scripts/goIosVersion.js has no GO_IOS_SHA256. Run tsc -b first.');
    expect(() =>
      pinFrom({
        GO_IOS_VERSION: 'v1',
        GO_IOS_PACKAGE_SPEC: 's',
        GO_IOS_PACKAGE_ENTRY: '',
        GO_IOS_SHA256: 'h',
      }),
    ).to.throw('has no GO_IOS_PACKAGE_ENTRY.');
  });

  it('keeps a binary whose SHA-256 is the pin and runs nothing', () => {
    fs.writeFileSync(path.join(vendorDir, 'ios'), CONTENT);
    const run = sinon.spy();
    expect(fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.equal('kept');
    expect(run.called).to.equal(false);
  });

  it('packs the pinned release, takes only the entry, installs it at 0755', () => {
    const { run, calls } = fakeRun({ content: CONTENT });
    expect(fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.equal('fetched');
    expect(calls[0].args.slice(0, 2)).to.deep.equal(['pack', 'go-ios@1.2.1']);
    expect(calls[0].args).to.include('--json');
    // Under `npm publish --dry-run` npm hands its children npm_config_dry_run,
    // and a pack that inherits it writes no tarball.
    expect(calls[0].args).to.include('--dry-run=false');
    expect(calls[1].args[0]).to.equal('-xzf');
    expect(calls[1].args[calls[1].args.length - 1]).to.equal(pin.packageEntry);
    expect(fs.readFileSync(path.join(vendorDir, 'ios'))).to.deep.equal(CONTENT);
    expect(fs.statSync(path.join(vendorDir, 'ios')).mode & 0o777).to.equal(0o755);
    expect(fs.readdirSync(vendorDir).filter((f) => f.startsWith('.fetch-'))).to.deep.equal([]);
  });

  it('replaces a binary whose SHA-256 differs from the pin', () => {
    fs.writeFileSync(path.join(vendorDir, 'ios'), 'truncated');
    const { run } = fakeRun({ content: CONTENT });
    expect(fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.equal('fetched');
    expect(sha256OfFile(path.join(vendorDir, 'ios'))).to.equal(SHA);
  });

  it('leaves nothing in place when the hash is wrong', () => {
    const { run } = fakeRun({ content: Buffer.from('tampered') });
    expect(() => fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.throw(
      `expected ${SHA} (GO_IOS_SHA256)`,
    );
    expect(fs.readdirSync(vendorDir)).to.deep.equal([]);
  });

  it('refuses a tarball without the entry', () => {
    const { run } = fakeRun({ content: CONTENT, omitEntry: true });
    expect(() => fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.throw(
      `go-ios@1.2.1 has no ${pin.packageEntry}`,
    );
  });

  it('says npm pack failed, and leaves nothing in place, when it writes no tarball', () => {
    const { run, calls } = fakeRun({ content: CONTENT, noTarball: true });
    expect(() => fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.throw(
      'go-ios: npm pack go-ios@1.2.1 failed (no tarball was written). Check that npm can reach its registry.',
    );
    expect(
      calls.map((c) => c.cmd),
      'no tar on a tarball that is not there',
    ).to.deep.equal(['npm']);
    expect(fs.readdirSync(vendorDir)).to.deep.equal([]);
  });

  it('says to check the registry when npm pack fails', () => {
    const run = () => {
      throw new Error('npm error code E404\nmore');
    };
    expect(() => fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.throw(
      'go-ios: npm pack go-ios@1.2.1 failed (npm error code E404). Check that npm can reach its registry.',
    );
  });

  it('checks the shipped binary: missing, not executable, wrong hash', () => {
    const bin = path.join(vendorDir, 'ios');
    expect(checkBundledGoIos({ pin, binaryPath: bin })).to.deep.equal([
      `${bin} is missing. Run npm run build.`,
    ]);
    fs.writeFileSync(bin, 'x', { mode: 0o644 });
    expect(checkBundledGoIos({ pin, binaryPath: bin })).to.include(`${bin} is not executable.`);
    expect(checkBundledGoIos({ pin, binaryPath: bin }).join()).to.contain(`expected ${SHA}`);
    fs.writeFileSync(bin, CONTENT);
    fs.chmodSync(bin, 0o755);
    expect(checkBundledGoIos({ pin, binaryPath: bin })).to.deep.equal([]);
  });

  it('checks what npm pack would publish', () => {
    const entryPath = 'lib/src/device-managers/ios/vendor/go-ios/ios';
    const packed = (files: object[]) => () => JSON.stringify([{ files }]);
    expect(
      checkPackedGoIos({
        rootDir: vendorDir,
        entryPath,
        run: packed([{ path: entryPath, mode: 0o755 }]),
      }),
    ).to.deep.equal([]);
    expect(
      checkPackedGoIos({
        rootDir: vendorDir,
        entryPath,
        run: packed([{ path: entryPath, mode: 0o644 }]),
      }),
    ).to.deep.equal([
      `npm pack would include ${entryPath} with mode 644, which is not executable.`,
    ]);
    expect(checkPackedGoIos({ rootDir: vendorDir, entryPath, run: packed([]) })).to.deep.equal([
      `npm pack would not include ${entryPath}.`,
    ]);
    expect(
      checkPackedGoIos({ rootDir: vendorDir, entryPath, run: packed([{ path: entryPath }]) }),
    ).to.deep.equal([`npm pack did not report the mode of ${entryPath}.`]);
  });

  // npm 10 runs `prepare` on a pack even with --ignore-scripts, and in the
  // foreground unless told otherwise, which put its output before the JSON.
  it('packs with --ignore-scripts and prepare in the background, so stdout is only the JSON', () => {
    const run = sinon.spy(() => JSON.stringify([{ files: [] }]));
    checkPackedGoIos({ rootDir: vendorDir, entryPath: 'x', run });
    // The spy's own function takes no arguments, so its calls are typed `[]`.
    expect((run.firstCall.args as unknown[])[1]).to.include.members([
      'pack',
      '--dry-run',
      '--json',
      '--ignore-scripts',
      '--foreground-scripts=false',
    ]);
  });
});

// The build fetches go-ios and ships it in lib/; the publish checks it is
// there and executable. Nothing else runs these steps, so their wiring in
// package.json is held here.
describe('the bundled go-ios (package.json)', () => {
  const scripts = (pkg as any).scripts as Record<string, string>;
  const steps = (script: string) => script.split('&&').map((step) => step.trim());

  it('fetches go-ios after tsc -b and before build:copy', () => {
    const build = steps(scripts.build);
    const fetch = build.indexOf('node scripts/fetch-go-ios.js');
    expect(fetch, 'build runs the fetch').to.be.greaterThan(-1);
    expect(build.indexOf('tsc -b')).to.be.within(0, fetch - 1);
    expect(build.indexOf('npm run build:copy')).to.be.greaterThan(fetch);
  });

  // macOS keeps a binary's signature check per file, and `cp` over an
  // existing file keeps that file: the new go-ios could be killed on launch.
  it('copies go-ios into lib/ as a new file, keeping its mode, with its licence and README', () => {
    const vendor = 'src/device-managers/ios/vendor/go-ios';
    const shipped = 'lib/src/device-managers/ios/vendor/go-ios';
    const copy = steps(scripts['build:copy']);
    const remove = copy.indexOf(`rm -f ${shipped}/ios`);
    const cp = copy.findIndex((step) => step.startsWith(`cp -p ${vendor}/ios `));
    expect(remove, 'build:copy removes the old binary').to.be.greaterThan(-1);
    expect(cp, 'build:copy copies the binary with cp -p').to.be.greaterThan(remove);
    expect(copy[cp].split(/\s+/).slice(2)).to.deep.equal([
      `${vendor}/ios`,
      `${vendor}/LICENSE-go-ios.txt`,
      `${vendor}/README.md`,
      `${shipped}/`,
    ]);
  });

  it('checks the package before it is published', () => {
    expect(steps(scripts.prepublishOnly).pop()).to.equal(
      'node scripts/fetch-go-ios.js --check-package',
    );
    expect((pkg as any).files).to.include('lib');
  });
});
