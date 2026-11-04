import { expect } from 'chai';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const goIosBundle = require('../../scripts/lib/go-ios-bundle');
const { pinFrom, sha256OfFile, fetchBundledGoIos, checkBundledGoIos, checkPackedGoIos } =
  goIosBundle;

// The build takes go-ios out of its npm release's tarball and ships it in
// lib/. `npm pack` and `tar` are handed in, so none of this needs a network:
// the fake below answers `npm pack` with a tarball's name, and `tar` by
// writing the one entry it was asked for into the folder it was given.

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

function fakeRun({ content, omitEntry = false }: { content: Buffer; omitEntry?: boolean }) {
  const calls: RunCall[] = [];
  const run = (cmd: string, args: string[], opts: { cwd: string }) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'npm') return JSON.stringify([{ filename: 'go-ios-1.2.1.tgz' }]);
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
