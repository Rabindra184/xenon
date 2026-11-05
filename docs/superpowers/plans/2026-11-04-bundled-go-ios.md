# Bundled go-ios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xenon ships the go-ios binary it pins inside its npm package, so a Mac that installs or upgrades Xenon runs iPhones with no separate go-ios step.

**Architecture:** At build time `scripts/fetch-go-ios.js` takes the Mac binary out of the `go-ios` npm tarball (`npm pack`, no install scripts), checks its SHA-256 against the pin, and `build:copy` ships it under `lib/`. At run time `goIosBinaryPath()` points beside its own module. The boot reap also covers the old `~/.cache/xenon/goIOS/ios`, the old installer becomes a check, and Xenon Control reads the bundled binary.

**Tech Stack:** TypeScript 5.5, Mocha + Chai + Sinon, plain Node build scripts (`scripts/`, `scripts/lib/`), npm `pack`, BSD/GNU `tar`, Xenon Control on Electron + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-bundled-go-ios-design.md`

## Global Constraints

- Pin: `GO_IOS_VERSION = 'v1.2.1'`, `GO_IOS_PACKAGE_SPEC = 'go-ios@1.2.1'`, `GO_IOS_PACKAGE_ENTRY = 'package/dist/go-ios-darwin-arm64_darwin_arm64/ios'`, `GO_IOS_SHA256 = 'b8a279520a875c62d281a7a9e23fe187401ab1c4af1eb328e329ce6e364d8611'` (44,504,402 bytes, universal x86_64 + arm64).
- Bundled binary: `src/device-managers/ios/vendor/go-ios/ios` (gitignored), shipped as `lib/src/device-managers/ios/vendor/go-ios/ios`. Legacy: `~/.cache/xenon/goIOS/ios`, reaped at start only, kept until 3.0.
- Nothing is downloaded at run time. `go-ios` is never a dependency, and no script of its runs.
- Keep `GO_IOS_VERSION` as a literal `export const` in `src/scripts/goIosVersion.ts`: Xenon Control reads `exports.GO_IOS_VERSION = '…'` from the compiled file as text (`mac-app/src/main/goIosPin.ts`).
- Work in a git worktree on `feat/bundled-go-ios` (superpowers:using-git-worktrees), with the main checkout back on `main`. The lab's plugin links to the main checkout: never build there.
- In the worktree, symlink `node_modules` and `mac-app/node_modules` from the main checkout. Build with `npx tsc -b && node scripts/fetch-go-ios.js && npm run build:copy` (not `npm run build`: `generate-prisma.js` writes the worktree path into `src/generated`; `git checkout -- src/generated` if it did). Never `npm install`/`uninstall` against the symlinked `node_modules`: use `--package-lock-only`.
- Free at least 2 GB of disk before Task 3 (the disk had 180 MB free on 2026-11-04). The fetch downloads 58 MB and holds 44 MB more; the live checks need about 1 GB.
- Tests follow CLAUDE.md: import what they use (`reflect-metadata`), hooks inside `describe`, `process.kill` stubbed wherever a test can reach it. The one real `pgrep`/`pkill` test kills only a process it started from a unique temporary path.
- Never `eslint --fix`. Compare the lint error count with a baseline from before Task 1.
- Xenon Control's text is for testers: no commands, option keys or paths in a check's detail or remediation.
- Stage explicit paths only. Commit messages carry no attribution lines.
- Subagents run on model opus.

## Review Focus

1. **An `APPIUM_HOME` whose path holds spaces, `+`, `(`, `[` or `'`.** The bundled path sits under it and the reap's `pgrep -f` takes a regular expression in a shell string. Expect the reap to match exactly that binary. Test: Task 4, "finds and kills a process whose path holds spaces and regex characters".
2. **An install where npm dropped the executable bit, in a folder the server can't write.** Expect one `chmod` attempt, then `false` and a warning to reinstall, never a spawn that fails with EACCES. Test: Task 1, "is not-executable when chmod fails".
3. **A Linux server with `platform: both` that sees an iPhone.** Expect go-ios reported unavailable ('not-mac'), not a Mach-O binary spawned. Test: Task 1, "is not-mac off macOS without touching the file".
4. **A fetch interrupted, or a truncated binary left at the target.** Expect the next build to replace it and no `.fetch-*` folder to stay behind. Tests: Task 3, "replaces a binary whose SHA-256 differs from the pin" and "leaves nothing in place when the hash is wrong".
5. **Xenon Control and Xenon at different versions.** An older Xenon Control's Set up runs the old installer: expect exit 0. A newer Xenon Control on an older Xenon (no marker): expect today's cache check. Tests: Task 2, "exits 0 when go-ios comes with Xenon"; Task 5, "still runs the installer for an older Xenon" and the unchanged cache cases.

---

### Task 1: Where go-ios is, and whether it can run

**Files:**
- Modify: `src/device-managers/ios/goIosBinary.ts`
- Test: `test/unit/go-ios-binary.spec.ts` (create)

**Interfaces:**
- Consumes: `GO_IOS_VERSION` from `src/scripts/goIosVersion.ts` (exists).
- Produces:
  - `goIosBinaryPath(): string`, `path.join(__dirname, 'vendor', 'go-ios', 'ios')`.
  - `legacyGoIosBinaryPath(): string`, `path.join(cachePath('goIOS'), 'ios')`.
  - `type GoIosBinaryState = 'ok' | 'not-mac' | 'missing' | 'not-executable'`.
  - `interface GoIosCheckDeps { platform: NodeJS.Platform; exists(p: string): boolean; isExecutable(p: string): boolean; makeExecutable(p: string): void }`.
  - `checkGoIosBinary(binaryPath: string, deps?: GoIosCheckDeps): GoIosBinaryState`.
  - `goIosStateMessage(state: Exclude<GoIosBinaryState, 'ok'>, binaryPath: string): string`.
  - `goIosStartupReport(platformArg: unknown, state: GoIosBinaryState, binaryPath: string): { level: 'info' | 'warn'; message: string } | null`.

- [ ] **Step 1: Write the failing tests** in `test/unit/go-ios-binary.spec.ts`

```ts
const IOS_DIR = path.resolve(__dirname, '../../src/device-managers/ios');
const BIN = '/plugin/lib/src/device-managers/ios/vendor/go-ios/ios';
const deps = (o: Partial<GoIosCheckDeps> = {}) => ({
  platform: 'darwin' as NodeJS.Platform,
  exists: () => true,
  isExecutable: () => true,
  makeExecutable: () => undefined,
  ...o,
});

describe('where go-ios is', () => {
  it('is beside the module, in vendor/go-ios', () => {
    expect(goIosBinaryPath()).to.equal(path.join(IOS_DIR, 'vendor', 'go-ios', 'ios'));
  });
  it('was under the home folder before 2.18 (legacy)', () => {
    expect(legacyGoIosBinaryPath()).to.equal(path.join(os.homedir(), '.cache', 'xenon', 'goIOS', 'ios'));
  });
});

describe('checkGoIosBinary', () => {
  it('is ok on a Mac when the file is there and executable', () => {
    expect(checkGoIosBinary(BIN, deps())).to.equal('ok');
  });
  it('is not-mac off macOS without touching the file', () => {
    const exists = sinon.spy(() => true);
    expect(checkGoIosBinary(BIN, deps({ platform: 'linux', exists }))).to.equal('not-mac');
    expect(exists.called).to.equal(false);
  });
  it('is missing when the file is not there', () => {
    expect(checkGoIosBinary(BIN, deps({ exists: () => false }))).to.equal('missing');
  });
  it('makes a non-executable file executable once and is then ok', () => {
    let x = false;
    const makeExecutable = sinon.spy(() => { x = true; });
    expect(checkGoIosBinary(BIN, deps({ isExecutable: () => x, makeExecutable }))).to.equal('ok');
    expect(makeExecutable.calledOnceWithExactly(BIN)).to.equal(true);
  });
  it('is not-executable when chmod fails', () => {
    const makeExecutable = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
    expect(checkGoIosBinary(BIN, deps({ isExecutable: () => false, makeExecutable }))).to.equal('not-executable');
  });
});

describe('what Xenon says about go-ios', () => {
  it('names the path and says to reinstall when missing', () => {
    expect(goIosStateMessage('missing', BIN)).to.equal(
      `go-ios is missing from this Xenon install (${BIN}). Reinstall the plugin.`);
  });
  it('says so when it cannot be made executable', () => {
    expect(goIosStateMessage('not-executable', BIN)).to.equal(
      `go-ios at ${BIN} can't be run and couldn't be made executable. Reinstall the plugin.`);
  });
  it('says iPhones need a Mac off macOS', () => {
    expect(goIosStateMessage('not-mac', BIN)).to.equal('go-ios comes with Xenon for macOS only. iPhones need a Mac.');
  });
  it('logs the bundled go-ios at start for ios and both, any case', () => {
    expect(goIosStartupReport('both', 'ok', BIN)).to.deep.equal({
      level: 'info', message: `go-ios v1.2.1 (comes with Xenon): ${BIN}` });
    expect(goIosStartupReport('IOS', 'missing', BIN)).to.deep.equal({
      level: 'warn', message: goIosStateMessage('missing', BIN) });
  });
  it('logs nothing for android, or off macOS', () => {
    expect(goIosStartupReport('android', 'missing', BIN)).to.equal(null);
    expect(goIosStartupReport('both', 'not-mac', BIN)).to.equal(null);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx mocha test/unit/go-ios-binary.spec.ts`
Expected: FAIL. `legacyGoIosBinaryPath`, `checkGoIosBinary` and the others are not exported, and the bundled path is still the cache path.

- [ ] **Step 3: Implement the exports above in `src/device-managers/ios/goIosBinary.ts`**

The default deps are `process.platform`, `fs.existsSync`, `fs.accessSync(p, fs.constants.X_OK)` (true unless it throws) and `fs.chmodSync(p, 0o755)`. `checkGoIosBinary` checks platform first, then existence, then executability; it calls `makeExecutable` once inside a try and checks once more. `goIosStartupReport` lowercases `String(platformArg)`, returns null unless it is `ios` or `both`, and returns null for `not-mac`. Rewrite the docblock: the binary ships with the plugin (see `scripts/fetch-go-ios.js`), and the reap finds go-ios processes by this path and the legacy one.

- [ ] **Step 4: Run them to see them pass**

Run: `npx mocha test/unit/go-ios-binary.spec.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/device-managers/ios/goIosBinary.ts test/unit/go-ios-binary.spec.ts
git commit -m "feat(ios): go-ios is found beside the plugin's own code"
```

### Task 2: The pin, the old installer, and its dependencies

**Files:**
- Modify: `src/scripts/goIosVersion.ts`
- Modify (rewrite): `src/scripts/install-go-ios.ts`
- Modify: `package.json`, `package-lock.json` (remove `download`, `unzipper`)
- Test: `test/unit/go-ios-version.spec.ts` (rewrite), `test/unit/install-go-ios.spec.ts` (create)

**Interfaces:**
- Consumes: `checkGoIosBinary`, `goIosBinaryPath`, `goIosStateMessage`, `GoIosBinaryState` (Task 1).
- Produces:
  - In `goIosVersion.ts`: `GO_IOS_VERSION`, `GO_IOS_PACKAGE_SPEC`, `GO_IOS_PACKAGE_ENTRY`, `GO_IOS_SHA256` (values in Global Constraints). `GO_IOS_VERSION_FILE`, `goIOSDownloadUrl` and `needsGoIOSInstall` are removed.
  - In `install-go-ios.ts`: `installGoIosCheck(state: GoIosBinaryState, binaryPath: string): { exitCode: 0 | 1; message: string }`.

- [ ] **Step 1: Rewrite `test/unit/go-ios-version.spec.ts`**

Keep its comment on #187, and keep the test "is pinned at or above v1.2.1". Drop the `goIOSDownloadUrl` and `needsGoIOSInstall` tests and add:

```ts
it('names the npm release of the pinned version', () => {
  expect(GO_IOS_PACKAGE_SPEC).to.equal(`go-ios@${GO_IOS_VERSION.replace(/^v/, '')}`);
});
it('takes the Mac binary from the tarball', () => {
  expect(GO_IOS_PACKAGE_ENTRY).to.match(/^package\/dist\/go-ios-darwin-[a-z0-9]+_darwin_[a-z0-9]+\/ios$/);
});
it('pins the binary by a SHA-256', () => {
  expect(GO_IOS_SHA256).to.match(/^[0-9a-f]{64}$/);
});
it('keeps the line Xenon Control reads', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/scripts/goIosVersion.ts'), 'utf8');
  expect(src).to.match(/^export const GO_IOS_VERSION = '[^']+';$/m);
});
```

- [ ] **Step 2: Write `test/unit/install-go-ios.spec.ts`**

```ts
const BIN = '/plugin/lib/src/device-managers/ios/vendor/go-ios/ios';
describe('the old go-ios installer, now a check', () => {
  it('exits 0 when go-ios comes with Xenon', () => {
    expect(installGoIosCheck('ok', BIN)).to.deep.equal({
      exitCode: 0, message: `go-ios v1.2.1 comes with this Xenon (${BIN}). Nothing to install.` });
  });
  it('exits 0 off macOS, saying iPhones need a Mac', () => {
    expect(installGoIosCheck('not-mac', BIN)).to.deep.equal({ exitCode: 0, message: goIosStateMessage('not-mac', BIN) });
  });
  it('exits 1 when the bundled go-ios is missing or cannot run', () => {
    expect(installGoIosCheck('missing', BIN)).to.deep.equal({ exitCode: 1, message: goIosStateMessage('missing', BIN) });
    expect(installGoIosCheck('not-executable', BIN).exitCode).to.equal(1);
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npx mocha test/unit/go-ios-version.spec.ts test/unit/install-go-ios.spec.ts`
Expected: FAIL. `GO_IOS_PACKAGE_SPEC` is undefined, and `installGoIosCheck` is not exported.

- [ ] **Step 4: Implement**

- `goIosVersion.ts`: add the three constants under `GO_IOS_VERSION`, each with a one-line comment. Remove the removed exports. Its docblock says why the pin matters (keep that) and that `scripts/fetch-go-ios.js` takes the binary from the npm tarball and checks it.
- `install-go-ios.ts`: replace the whole file, `@ts-nocheck` included. Export `installGoIosCheck`. A `main()` runs only under `require.main === module`: it logs the message through `log.scope('GoIOSInstall')` (`info` for exit 0, `error` for 1) and sets `process.exitCode`. It downloads nothing. Its header comment says it stays so the README's old command and older Xenon Control versions still succeed.

- [ ] **Step 5: Remove the installer's dependencies**

Run: `grep -rnE "from 'download'|require\('download'\)|from 'unzipper'|require\('unzipper'\)" src scripts`
Expected: no output.
Run: `npm uninstall --package-lock-only download unzipper`, plus `@types/download` and `@types/unzipper` if `package.json` lists them.
Expected: `git diff --stat package.json package-lock.json` shows only those packages and the transitive packages nothing else needs. `ls node_modules/download` still works, because the shared `node_modules` was not touched.

- [ ] **Step 6: Run the tests and the compiler**

Run: `npx mocha test/unit/go-ios-version.spec.ts test/unit/install-go-ios.spec.ts test/unit/go-ios-binary.spec.ts && npx tsc -b`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/goIosVersion.ts src/scripts/install-go-ios.ts package.json package-lock.json test/unit/go-ios-version.spec.ts test/unit/install-go-ios.spec.ts
git commit -m "feat(ios): pin go-ios by npm release and SHA-256; the old installer only checks"
```

### Task 3: The build takes go-ios from npm and ships it

**Files:**
- Create: `scripts/lib/go-ios-bundle.js`, `scripts/fetch-go-ios.js`
- Create: `src/device-managers/ios/vendor/go-ios/LICENSE-go-ios.txt`, `src/device-managers/ios/vendor/go-ios/README.md`
- Modify: `.gitignore`, `package.json` (`build`, `build:copy`, `prepublishOnly`)
- Test: `test/unit/go-ios-bundle.spec.ts` (create)

**Interfaces:**
- Consumes: the compiled pin, `lib/src/scripts/goIosVersion.js` (Task 2).
- Produces (CommonJS, `module.exports` of `scripts/lib/go-ios-bundle.js`):
  - `GoIosPin` = `{ version, packageSpec, packageEntry, sha256 }` (strings).
  - `RunFn` = `(cmd: string, args: string[], opts: { cwd: string }) => string`. It returns stdout and throws on a non-zero exit.
  - `pinFrom(goIosVersionModule) → GoIosPin`.
  - `sha256OfFile(file) → string | null` (null when missing).
  - `fetchBundledGoIos({ pin, vendorDir, rootDir, run }) → 'kept' | 'fetched'`. It throws an `Error` with one of the messages below.
  - `checkBundledGoIos({ pin, binaryPath }) → string[]` (problems, empty when fine).
  - `checkPackedGoIos({ rootDir, entryPath, run }) → string[]`.
  - `defaultRun` (`execFileSync`, utf8, `maxBuffer` 64 MB).

Messages, exactly:
- npm pack failed: `go-ios: npm pack ${spec} failed (${first line of the error}). Check that npm can reach its registry.`
- no entry: `go-ios: ${spec} has no ${entry}. Check GO_IOS_PACKAGE_ENTRY in src/scripts/goIosVersion.ts.`
- wrong hash: `go-ios: ${entry} in ${spec} has SHA-256 ${actual}, expected ${pin} (GO_IOS_SHA256).`
- `checkBundledGoIos`: `${binaryPath} is missing. Run npm run build.` / `${binaryPath} is not executable.` / `${binaryPath} has SHA-256 ${actual}, expected ${pin}.`
- `checkPackedGoIos`: `npm pack would not include ${entryPath}.` / `npm pack would include ${entryPath} with mode ${octal}, which is not executable.` / `npm pack did not report the mode of ${entryPath}.`

`fetchBundledGoIos` works like this:
1. If `sha256OfFile(<vendorDir>/ios)` is the pin, return `'kept'` without calling `run`.
2. Otherwise, `fs.mkdtempSync(path.join(vendorDir, '.fetch-'))`.
3. `run('npm', ['pack', spec, '--pack-destination', tmp, '--json'], { cwd: rootDir })`. Parse the stdout JSON and take `[0].filename`.
4. `run('tar', ['-xzf', join(tmp, filename), '-C', tmp, entry], { cwd: rootDir })`.
5. The extracted file must exist and match the hash. `chmodSync(0o755)`, then `renameSync` to `<vendorDir>/ios`.
6. `rmSync(tmp, { recursive: true, force: true })` in a `finally`.

`checkPackedGoIos` runs `npm pack --dry-run --json --ignore-scripts` in `rootDir` and finds `[0].files[].path === entryPath`. Its mode must have `0o111`, and a missing mode fails closed. That replaces the spec's `tar -tv` fallback: npm's own output is the thing being judged.

- [ ] **Step 1: Write the failing tests** in `test/unit/go-ios-bundle.spec.ts`

Each test gets a fresh `vendorDir` from `fs.mkdtempSync(os.tmpdir() + '/go-ios-bundle-')`, created in `beforeEach` and removed in `afterEach` inside the `describe`. The `fakeRun` used below records each call. For `npm pack` it returns `JSON.stringify([{ filename: 'go-ios-1.2.1.tgz' }])`. For `tar` it writes `content` at `join(<-C dir>, entry)`, unless told to leave the entry out.

```ts
const { pinFrom, sha256OfFile, fetchBundledGoIos, checkBundledGoIos, checkPackedGoIos } = require('../../scripts/lib/go-ios-bundle');
const CONTENT = Buffer.from('fake go-ios');
const SHA = crypto.createHash('sha256').update(CONTENT).digest('hex');
const pin = { version: 'v1.2.1', packageSpec: 'go-ios@1.2.1', packageEntry: 'package/dist/go-ios-darwin-arm64_darwin_arm64/ios', sha256: SHA };

it('maps the compiled pin module', () => {
  expect(pinFrom({ GO_IOS_VERSION: 'v1', GO_IOS_PACKAGE_SPEC: 's', GO_IOS_PACKAGE_ENTRY: 'e', GO_IOS_SHA256: 'h' }))
    .to.deep.equal({ version: 'v1', packageSpec: 's', packageEntry: 'e', sha256: 'h' });
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
  expect(() => fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.throw(`expected ${SHA} (GO_IOS_SHA256)`);
  expect(fs.readdirSync(vendorDir)).to.deep.equal([]);
});
it('refuses a tarball without the entry', () => {
  const { run } = fakeRun({ content: CONTENT, omitEntry: true });
  expect(() => fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run })).to.throw(`go-ios@1.2.1 has no ${pin.packageEntry}`);
});
it('says to check the registry when npm pack fails', () => {
  const run = () => { throw new Error('npm error code E404\nmore'); };
  expect(() => fetchBundledGoIos({ pin, vendorDir, rootDir: vendorDir, run }))
    .to.throw('go-ios: npm pack go-ios@1.2.1 failed (npm error code E404). Check that npm can reach its registry.');
});
it('checks the shipped binary: missing, not executable, wrong hash', () => {
  const bin = path.join(vendorDir, 'ios');
  expect(checkBundledGoIos({ pin, binaryPath: bin })).to.deep.equal([`${bin} is missing. Run npm run build.`]);
  fs.writeFileSync(bin, 'x', { mode: 0o644 });
  expect(checkBundledGoIos({ pin, binaryPath: bin })).to.include(`${bin} is not executable.`);
  expect(checkBundledGoIos({ pin, binaryPath: bin }).join()).to.contain(`expected ${SHA}`);
  fs.writeFileSync(bin, CONTENT); fs.chmodSync(bin, 0o755);
  expect(checkBundledGoIos({ pin, binaryPath: bin })).to.deep.equal([]);
});
it('checks what npm pack would publish', () => {
  const entryPath = 'lib/src/device-managers/ios/vendor/go-ios/ios';
  const packed = (files: object[]) => () => JSON.stringify([{ files }]);
  expect(checkPackedGoIos({ rootDir: vendorDir, entryPath, run: packed([{ path: entryPath, mode: 0o755 }]) })).to.deep.equal([]);
  expect(checkPackedGoIos({ rootDir: vendorDir, entryPath, run: packed([{ path: entryPath, mode: 0o644 }]) }))
    .to.deep.equal([`npm pack would include ${entryPath} with mode 644, which is not executable.`]);
  expect(checkPackedGoIos({ rootDir: vendorDir, entryPath, run: packed([]) })).to.deep.equal([`npm pack would not include ${entryPath}.`]);
  expect(checkPackedGoIos({ rootDir: vendorDir, entryPath, run: packed([{ path: entryPath }]) }))
    .to.deep.equal([`npm pack did not report the mode of ${entryPath}.`]);
});
it('packs with --ignore-scripts, so Xenon\'s prepare does not run', () => {
  const run = sinon.spy(() => JSON.stringify([{ files: [] }]));
  checkPackedGoIos({ rootDir: vendorDir, entryPath: 'x', run });
  expect(run.firstCall.args[1]).to.include.members(['pack', '--dry-run', '--json', '--ignore-scripts']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx mocha test/unit/go-ios-bundle.spec.ts`
Expected: FAIL with "Cannot find module '../../scripts/lib/go-ios-bundle'".

- [ ] **Step 3: Implement `scripts/lib/go-ios-bundle.js`** (the interfaces and steps above, in the style of `scripts/lib/sync-dir.js`)

- [ ] **Step 4: Run them to see them pass**

Run: `npx mocha test/unit/go-ios-bundle.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Write `scripts/fetch-go-ios.js`**

- `ROOT = path.resolve(__dirname, '..')`.
- The pin is `pinFrom(require(path.join(ROOT, 'lib/src/scripts/goIosVersion.js')))`. If that file is missing, print `::error::go-ios: lib/src/scripts/goIosVersion.js is missing. Run tsc -b first.` and exit 1.
- With no argument: `fetchBundledGoIos` into `src/device-managers/ios/vendor/go-ios`. Print `go-ios ${version}: kept the checked binary` or `go-ios ${version}: fetched ${spec} and checked it`. On a throw, print `::error::${message}` and exit 1.
- With `--check-package`: the problems of `checkBundledGoIos` on `lib/src/device-managers/ios/vendor/go-ios/ios` and of `checkPackedGoIos` for the same relative path. Print each as `::error::<problem>` and exit 1, or print `go-ios ${version}: ready to publish`.

- [ ] **Step 6: Commit the vendor folder's text files**

- `LICENSE-go-ios.txt`: `gh api 'repos/danielpaulus/go-ios/contents/LICENSE?ref=v1.2.1' --jq .content | base64 -d`. Expect the MIT licence.
- `README.md`, modelled on `src/services/ocr/vendor/README.md`. It covers:
  - why go-ios is vendored: it used to be installed into `~/.cache/xenon/goIOS` by hand, and npm's `go-ios` runs a script that writes into npm's global bin;
  - provenance: `go-ios@1.2.1`, entry `package/dist/go-ios-darwin-arm64_darwin_arm64/ios` (the `darwin-amd64` folder holds the same file), MIT, 44,504,402 bytes, the SHA-256, universal x86_64 + arm64; the same file Xenon 2.17's installer put at `~/.cache/xenon/goIOS/ios`;
  - that `scripts/fetch-go-ios.js` fetches and checks it, and that the binary itself is not committed;
  - the bump procedure from the spec's "Moving the pin later".
- `.gitignore`: add `/src/device-managers/ios/vendor/go-ios/ios` and `/src/device-managers/ios/vendor/go-ios/.fetch-*` under a comment naming `scripts/fetch-go-ios.js`.
- `package.json`:
  - `build`: `node scripts/generate-prisma.js && tsc -b && node scripts/fetch-go-ios.js && npm run build:copy`.
  - Append to `build:copy`: `&& mkdir -p lib/src/device-managers/ios/vendor/go-ios && cp -p src/device-managers/ios/vendor/go-ios/ios src/device-managers/ios/vendor/go-ios/LICENSE-go-ios.txt src/device-managers/ios/vendor/go-ios/README.md lib/src/device-managers/ios/vendor/go-ios/`.
  - `prepublishOnly`: `npm run build:all && node scripts/fetch-go-ios.js --check-package`.

- [ ] **Step 7: Fetch for real** (needs the free disk from Global Constraints)

Run: `npx tsc -b && node scripts/fetch-go-ios.js`
Expected: `go-ios v1.2.1: fetched go-ios@1.2.1 and checked it`.
Then `ls -l src/device-managers/ios/vendor/go-ios/ios` shows `-rwxr-xr-x` and 44504402 bytes. `shasum -a 256` of it prints the pin. `git status --short` doesn't list it.
Run it again: `go-ios v1.2.1: kept the checked binary`.

- [ ] **Step 8: Check the package**

Run: `npm run build:copy && node scripts/fetch-go-ios.js --check-package`
Expected: `go-ios v1.2.1: ready to publish`.
Run: `chmod 644 lib/src/device-managers/ios/vendor/go-ios/ios && node scripts/fetch-go-ios.js --check-package; echo $?`
Expected: two `::error::` lines (the file isn't executable, and npm pack would publish it as 644), then `1`. Then `chmod 755` it back.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/go-ios-bundle.js scripts/fetch-go-ios.js src/device-managers/ios/vendor/go-ios/LICENSE-go-ios.txt src/device-managers/ios/vendor/go-ios/README.md .gitignore package.json test/unit/go-ios-bundle.spec.ts
git commit -m "build: take go-ios from its npm release, check it, ship it in lib/"
```

### Task 4: The server uses it, and cleans up both paths at start

**Files:**
- Modify: `src/device-managers/ios/tunnelProcess.ts` (`reapAllOrphanTunnels`)
- Modify: `src/device-managers/ios/IOSStreamService.ts` (`isGoIOSAvailable`, `reapOrphanTunnels`)
- Modify: `src/services/ServerManager.ts` (`reapLeftoverGoIos`, new `reportBundledGoIos`)
- Test: `test/unit/ios-tunnel-process.spec.ts`, `test/unit/boot-go-ios-reap.spec.ts`, `test/unit/ios-stream-go-ios.spec.ts` (create)

**Interfaces:**
- Consumes: `checkGoIosBinary`, `goIosStateMessage`, `goIosStartupReport`, `goIosBinaryPath`, `legacyGoIosBinaryPath` (Task 1).
- Produces:
  - `goIosProcessPattern(binaryPath: string): string`, a single-quoted shell word holding the path with ERE metacharacters (`\ ^ $ . | ? * + ( ) [ ] { }`) backslash-escaped, and `'` written as `'\''`.
  - `IOSStreamService.reapOrphanTunnels(opts?: { includeLegacy?: boolean }): Promise<void>`.
  - `ServerManager.reportBundledGoIos(pluginArgs: IPluginArgs): void` (private).

- [ ] **Step 1: Write the failing tests**

In `ios-tunnel-process.spec.ts`, inside `describe('reapAllOrphanTunnels')`:
- Change the first test's assertion to `c.includes(goIosProcessPattern(binary))`.
- Add:

```ts
it('quotes the path and escapes what a regular expression would read', () => {
  expect(goIosProcessPattern('/Users/q a/.appium+(x)[1]/ios')).to.equal(`'/Users/q a/\\.appium\\+\\(x\\)\\[1\\]/ios'`);
  expect(goIosProcessPattern("/Users/o'neil/ios")).to.equal(`'/Users/o'\\''neil/ios'`);
});
it('finds and kills a process whose path holds spaces and regex characters', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go ios+(x)['"));
  const fake = path.join(dir, 'ios');
  fs.copyFileSync('/bin/sleep', fake);
  fs.chmodSync(fake, 0o755);
  const child = spawn(fake, ['30']);
  try {
    await once(child, 'spawn');
    expect(await reapAllOrphanTunnels(fake, promisify(exec))).to.equal(1);
    await once(child, 'exit');
    expect(child.signalCode).to.equal('SIGKILL');
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

In `boot-go-ios-reap.spec.ts`, in the first test:
- `sinon.stub(boot, 'reportBundledGoIos').callsFake(() => steps.push('go-ios report'))`;
- expect the order `['database config', 'database and migrations', 'reap', 'go-ios report', 'routes']`;
- assert the reap stub was `calledOnceWithExactly({ includeLegacy: true })`.

Create `test/unit/ios-stream-go-ios.spec.ts`. Import `reflect-metadata`, and create the service and stub `PortAllocator.prototype.releasePurpose` as `ios-stream-port-leases.spec.ts` does. Stub `tunnelProcess.reapAllOrphanTunnels` (via `import * as tunnelProcess`) and `goIosBinary.checkGoIosBinary`.
- "reaps only the bundled path at shutdown": `reapOrphanTunnels()` reaps once, with `service.goIOSPath`.
- "reaps the bundled and the legacy path at start": `reapOrphanTunnels({ includeLegacy: true })` reaps with `service.goIOSPath`, then with `legacyGoIosBinaryPath()`, and `releasePurpose('tunnel')` is called once.
- "is unavailable, and says why, when the bundled go-ios is missing": with the check returning `'missing'`, `isGoIOSAvailable()` is false and the warning is `goIosStateMessage('missing', service.goIOSPath)` (spy on `log.warn`).
- "is available when the check is ok": true.

- [ ] **Step 2: Run them to see them fail**

Run: `npx mocha test/unit/ios-tunnel-process.spec.ts test/unit/boot-go-ios-reap.spec.ts test/unit/ios-stream-go-ios.spec.ts`
Expected: FAIL. `goIosProcessPattern` is not exported, there is no `reportBundledGoIos` step, and the reap gets no options.

- [ ] **Step 3: Implement**

- `tunnelProcess.ts`: export `goIosProcessPattern`. `reapAllOrphanTunnels` runs `pgrep -f ${pattern}` and `pkill -9 -f ${pattern}`, with the pattern unquoted in the template because it carries its own quotes.
- `IOSStreamService.isGoIOSAvailable`: `checkGoIosBinary(this.goIOSPath)`. Anything but `'ok'` warns `goIosStateMessage(state, this.goIOSPath)` and returns false.
- `IOSStreamService.reapOrphanTunnels(opts = {})`: reap `this.goIOSPath` and, with `includeLegacy`, `legacyGoIosBinaryPath()`, each in its own try. Log the total as today. Release the `tunnel` leases once. Update its docblock: start covers both paths, shutdown only the bundled one. `cleanup()` keeps calling it with no options.
- `ServerManager.reapLeftoverGoIos` calls `reapOrphanTunnels({ includeLegacy: true })`. `updateServer` calls `this.reportBundledGoIos(pluginArgs)` right after it. That method logs `goIosStartupReport(pluginArgs.platform, checkGoIosBinary(goIosBinaryPath()), goIosBinaryPath())` at its level through `this.logger`, if the report is not null.

- [ ] **Step 4: Run them to see them pass**

Run: `npx mocha test/unit/ios-tunnel-process.spec.ts test/unit/boot-go-ios-reap.spec.ts test/unit/ios-stream-go-ios.spec.ts test/unit/self-healing-boot.spec.ts`
Expected: PASS. `self-healing-boot.spec.ts` also stubs the boot's go-ios reap. If it now fails because `reportBundledGoIos` runs for real, stub it there too.

- [ ] **Step 5: Run every spec that touches go-ios**

Run: `npx mocha test/unit/ios-stream-port-leases.spec.ts test/unit/wda-client-shell.spec.ts test/unit/ios-stream-appium-tunnel.spec.ts test/unit/ios-go-ios-tunnel-env.spec.ts`
Expected: PASS. A test that relied on `isGoIOSAvailable()` being true from a real file should stub `checkGoIosBinary` to `'ok'`, not create the file.

- [ ] **Step 6: Commit**

```bash
git add src/device-managers/ios/tunnelProcess.ts src/device-managers/ios/IOSStreamService.ts src/services/ServerManager.ts test/unit/ios-tunnel-process.spec.ts test/unit/boot-go-ios-reap.spec.ts test/unit/ios-stream-go-ios.spec.ts
git commit -m "feat(ios): run the bundled go-ios; start reaps it and the old cache copy"
```

(Add `test/unit/self-healing-boot.spec.ts` and any spec Step 5 changed.)

### Task 5: Xenon Control knows a Xenon that ships go-ios

**Files:**
- Modify: `mac-app/src/main/setupPlan.ts`, `mac-app/src/main/SetupService.ts:143-150`, `mac-app/src/main/toolchainRules.ts` (`IphoneSupportInput`, `assessIphoneSupport`), `mac-app/src/main/ToolchainInspector.ts:266-286` (`checkGoIos`)
- Test: `mac-app/test/setupPlan.spec.ts`, `mac-app/test/toolchainRules.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at run time. It relies on the plugin's file layout from Task 3.
- Produces:
  - `GO_IOS_BUNDLE_MARKER = ['lib', 'src', 'device-managers', 'ios', 'vendor', 'go-ios', 'LICENSE-go-ios.txt'] as const`.
  - `GO_IOS_BUNDLED_BINARY = ['lib', 'src', 'device-managers', 'ios', 'vendor', 'go-ios', 'ios'] as const` (both in `setupPlan.ts`, beside `GO_IOS_SCRIPT`).
  - `planGoIosStep` input gains `bundled?: boolean`.
  - `IphoneSupportInput` gains `source?: 'bundled' | 'cache'` (default `'cache'`).

- [ ] **Step 1: Write the failing tests**

`setupPlan.spec.ts`, in `describe('planGoIosStep')`:

```ts
it('is not needed when the installed Xenon ships go-ios', () => {
  expect(planGoIosStep({ platform: 'ios', pluginDir: PLUGIN_DIR, scriptExists: true, bundled: true })).toEqual({ kind: 'not-needed' });
});
it('still runs the installer for an older Xenon', () => {
  expect(planGoIosStep({ platform: 'both', pluginDir: PLUGIN_DIR, scriptExists: true, bundled: false })).toEqual({
    kind: 'run', step: { step: 'install-go-ios', args: [SCRIPT] } });
});
```

`toolchainRules.spec.ts`, in `describe('assessIphoneSupport')` (the existing cases stay as they are: no `source` means the cache):

```ts
it('is ready when the installed Xenon ships go-ios', () => {
  expect(assessIphoneSupport({ ...base, source: 'bundled', installedVersion: null })).toEqual({
    status: 'ok', code: 'ok', detail: 'Ready for iPhones (go-ios v1.2.1)' });
});
it('says the install is incomplete when the shipped go-ios is missing', () => {
  expect(assessIphoneSupport({ ...base, source: 'bundled', binaryExists: false, installedVersion: null })).toEqual({
    status: 'warn', code: 'missing', detail: 'This Xenon install is incomplete',
    remediation: "iPhones won't work with this install. Reinstall Xenon for this profile." });
});
it('is not needed for Android-only profiles, shipped go-ios or not', () => {
  expect(assessIphoneSupport({ ...base, source: 'bundled', platform: 'android', binaryExists: false }).code).toBe('not-needed');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd mac-app && npx vitest run test/setupPlan.spec.ts test/toolchainRules.spec.ts`
Expected: FAIL in the new cases.

- [ ] **Step 3: Implement**

- `planGoIosStep`: after the android check, `bundled` gives `{ kind: 'not-needed' }`. Rewrite its docblock: a Xenon from 2.18 ships go-ios, and older ones need the installer.
- `SetupService`: pass `bundled: existsSync(path.join(pluginDir, ...GO_IOS_BUNDLE_MARKER))`. Its step-3 comment says go-ios comes with Xenon from 2.18 and older ones run the installer.
- `assessIphoneSupport`: on `source === 'bundled'`, after the android case, give the two outcomes tested above and skip the version comparison. The cache branch is unchanged.
- `checkGoIos`:
  - If `appiumHome` is set and the marker exists in `installedPluginDir(appiumHome)`, use `source: 'bundled'`. `binaryExists` is whether the bundled binary passes `accessSync(…, constants.X_OK)`, `installedVersion` is null, and `pinnedVersion` is `loadGoIosPin(pluginDir)`.
  - Otherwise, today's cache check.
  - Rewrite its docblock to match.

- [ ] **Step 4: Run them, and the app's type check**

Run: `cd mac-app && npx vitest run && npm run typecheck`
Expected: every test passes and typecheck prints no errors.

- [ ] **Step 5: Commit**

```bash
git add mac-app/src/main/setupPlan.ts mac-app/src/main/SetupService.ts mac-app/src/main/toolchainRules.ts mac-app/src/main/ToolchainInspector.ts mac-app/test/setupPlan.spec.ts mac-app/test/toolchainRules.spec.ts
git commit -m "feat(mac-app): a Xenon that ships go-ios needs no go-ios step"
```

### Task 6: Docs

**Files:**
- Modify: `README.md` (lines 116, 146-150, 434, 450 as of 51a8f80c)
- Modify: `website/docs/installation.md`, `quick-start.mdx`, `troubleshooting.md`, `upgrading.md`, `xenon-control.md`, `devices.md`, `device-control.md`, `architecture.md`, `cpu-and-memory.md`, `release-notes.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README**

- Requirements row: `A Mac with Xcode and the XCUITest driver. Xenon brings its own go-ios for real iPhones.`
- Remove the go-ios paragraph and its command from the quick start. Fix any link to "step 2" that pointed at it.
- Troubleshooting row: `An iPhone doesn't stream, or its sessions are refused as unhealthy; the log says go-ios is missing from this Xenon install` → `The install didn't finish. Reinstall the plugin.`
- Upgrade note: drop "and on a Mac with iPhones, run the go-ios install script again".

- [ ] **Step 2: Website**

Run: `grep -n -i "install-go-ios\|goIOS\|go-ios" website/docs/*.md website/docs/*.mdx`
Every mention of the install step or of `~/.cache/xenon/goIOS` either becomes "comes with Xenon" or goes. Mentions of what go-ios does stay.
Add a 2.18.0 entry to `release-notes.md` in its existing format:
- iPhones need no separate go-ios step;
- `~/.cache/xenon/goIOS` can be deleted once no older Xenon on that Mac uses it;
- update Xenon Control.

- [ ] **Step 3: CLAUDE.md**

Under "Device Streaming", before "A go-ios tunnel per iPhone", add a paragraph headed **Where go-ios comes from**:
- the bundled path and `goIosBinaryPath()`;
- how `scripts/fetch-go-ios.js` takes `GO_IOS_PACKAGE_ENTRY` out of `npm pack go-ios@<pin>`, checks `GO_IOS_SHA256` and why (npm's `go-ios` writes into npm's global bin, through 2.17 it was a manual step into `~/.cache/xenon/goIOS`);
- that start reaps both paths and shutdown only the bundled one, the legacy path until 3.0;
- `--check-package` in `prepublishOnly`;
- how to move the pin.

In "A go-ios tunnel per iPhone", "Who drives it", say the start's reap covers both paths. Add a Key Files row: `src/device-managers/ios/goIosBinary.ts` | `Where go-ios is (shipped beside it), the legacy cache path the start also reaps, and whether it can run here`.

- [ ] **Step 4: Build the website**

Run: in `website/` (in a worktree, copy its `node_modules` with `cp -cR` from the main checkout), `npm run build`.
Expected: the build finishes with no broken-link errors.

- [ ] **Step 5: Commit**

```bash
git add README.md website/docs/installation.md website/docs/quick-start.mdx website/docs/troubleshooting.md website/docs/upgrading.md website/docs/xenon-control.md website/docs/devices.md website/docs/device-control.md website/docs/architecture.md website/docs/cpu-and-memory.md website/docs/release-notes.md CLAUDE.md
git commit -m "docs: go-ios comes with Xenon"
```

(Stage only the files that changed.)

### Task 7: Whole-branch checks, then the live checks

**Files:** none changed, unless a check fails.

- [ ] **Step 1: The full suites**

Run: `export ANDROID_HOME=~/Library/Android/sdk && npm run test:all`
Expected: green.
Run: `npx tsc -b`, and `npx eslint src test scripts 2>&1 | grep -c error` compared with the baseline count.
Expected: tsc is clean and the error count is no higher.
Run: `cd mac-app && npx vitest run && npm run typecheck`
Expected: green.

- [ ] **Step 2: The package**

In the worktree: empty `src/public`, run `npx tsc -b && node scripts/fetch-go-ios.js && npm run build:copy`, then `npm pack --ignore-scripts`.
Run: `tar -tvzf xenon-device-management-xenon-*.tgz package/lib/src/device-managers/ios/vendor/go-ios/ios`
Expected: `-rwxr-xr-x` and 44504402.

- [ ] **Step 3: Install it with npm 10 and npm 12**

Follow the memory recipe for a tarball (a scratch home with `{"name":"appium-home","private":true}`, Appium's own `npm install --save-dev --no-progress --no-audit --omit=peer --save-exact --global-style --no-package-lock <tgz>`). Do it once with the system npm 10 and once with a scratch npm 12.
Expected each time:
- `<home>/node_modules/@xenon-device-management/xenon/lib/src/device-managers/ios/vendor/go-ios/ios` is executable and `version` prints v1.2.1;
- `ls "$(npm prefix -g)/bin"` is the same before and after.

- [ ] **Step 4: A scratch server on an iPhone, with no cache copy**

Use the iOS scratch-server recipe (worktree build, extensions.yaml repointed), but with a fake `HOME` that has **no** `.cache/xenon/goIOS`, and `platform: ios`.
- Ask the user first if the lab server holds the iPhone (a preview or a session). `stream/stop` releases a preview hold.
- Expected:
  - the start log has `go-ios v1.2.1 (comes with Xenon): <home>/node_modules/@xenon-device-management/xenon/lib/src/device-managers/ios/vendor/go-ios/ios`;
  - the iPhone's preview streams;
  - an Appium session on it starts and runs a few commands;
  - its Device logs and CPU and memory are recorded.

- [ ] **Step 5: The start reaps the legacy path**

Copy `/bin/sleep` to `<fake HOME>/.cache/xenon/goIOS/ios`, start it with `600`, then restart the scratch server with SIGTERM.
Expected: `pgrep -f "<fake HOME>/.cache/xenon/goIOS/[i]os"` finds nothing after the start. The lab's own go-ios, under the real home, is untouched (`pgrep -fl "[t]unnel start"` shows the same pids as before).

- [ ] **Step 6: Xenon Control**

Run Xenon Control from `mac-app` (`npm run dev`) with a profile whose Appium folder is the npm 12 scratch home and platform `ios`.
Expected: Health shows "iPhone support: Ready for iPhones (go-ios v1.2.1)", and Set up lists no iPhone support step.

- [ ] **Step 7: Open the PR**

Push `feat/bundled-go-ios` (`GH_TOKEN=$(gh auth token -u Rabindra184)`), and write the body to a file and pass `--body-file`. The body names:
- what moved (go-ios ships in the package; the old installer is a check);
- the npm package findings;
- the size change;
- the live results from Steps 3–6;
- that a release needs a version bump to 2.18.0 and a Xenon Control release.

Don't bump versions in this PR unless the user asks: a version change on `main` publishes.
