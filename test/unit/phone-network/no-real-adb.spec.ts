import { expect } from 'chai';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RealAdbRefused, adbCommand, guard } from '../../helpers/no-real-adb';

const REPO = path.resolve(__dirname, '../../..');
const HELPER = path.join(REPO, 'test/helpers/no-real-adb');
// A path where no adb is: if the guard ever let a call through, it would
// fail to start rather than reach a phone.
const NO_SUCH_ADB = '/nonexistent/xenon-spec/platform-tools/adb';

/** Runs `body` as a spec file of its own, in a child Mocha. */
function runSpec(body: string): { status: number | null; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-no-real-adb-'));
  try {
    const file = path.join(dir, 'fixture.spec.js');
    fs.writeFileSync(
      file,
      `const { forbidRealAdb } = require(${JSON.stringify(HELPER)});\n` +
        "const cp = require('child_process');\n" +
        `const ADB = ${JSON.stringify(NO_SUCH_ADB)};\n` +
        body,
    );
    const result = childProcess.spawnSync(
      process.execPath,
      [require.resolve('mocha/bin/mocha'), '--reporter', 'dot', file],
      { cwd: REPO, encoding: 'utf8', timeout: 90_000 },
    );
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The phone-network specs run on machines with real phones on their adb
 * server. Through 2.36 some of them ran that adb with a fake serial
 * (real-phone-shaping's resets, after useFakeAdb had already been taken off),
 * harmless only while no phone had the serial. forbidRealAdb refuses it, and
 * every spec here and under test/unit/interceptor carries it.
 */
describe("phone-network specs never run this machine's adb", function () {
  this.timeout(120_000);

  describe('adbCommand: which calls would start adb', () => {
    it('the SDK binary appium-adb runs, a bare adb, and a shell line starting with adb', () => {
      expect(
        adbCommand('spawn', [
          '/Users/me/Library/Android/sdk/platform-tools/adb',
          ['-P', '5037', '-s', 'R58M123', 'shell', 'svc', 'wifi', 'disable'],
        ]),
      ).to.equal(
        '/Users/me/Library/Android/sdk/platform-tools/adb -P 5037 -s R58M123 shell svc wifi disable',
      );
      expect(adbCommand('execFile', ['adb', ['devices']])).to.equal('adb devices');
      expect(adbCommand('spawnSync', ['C:\\sdk\\platform-tools\\adb.exe', []])).to.not.equal(
        undefined,
      );
      expect(adbCommand('exec', ['adb -s X reverse --remove-all'])).to.equal(
        'adb -s X reverse --remove-all',
      );
      expect(adbCommand('execSync', ['"/opt/sdk/platform-tools/adb" devices'])).to.not.equal(
        undefined,
      );
    });

    it('anything else is not adb', () => {
      expect(adbCommand('spawn', ['node', ['-e', 'adb']])).to.equal(undefined);
      expect(adbCommand('spawn', ['/usr/bin/adbkit', []])).to.equal(undefined);
      expect(adbCommand('exec', ['ls adb'])).to.equal(undefined);
      expect(adbCommand('spawn', [undefined])).to.equal(undefined);
    });
  });

  describe('guard', () => {
    it('refuses adb before it starts, reports it, and lets everything else run', () => {
      const refused: string[] = [];
      const release = guard((command) => refused.push(command));
      try {
        expect(() => childProcess.spawn(NO_SUCH_ADB, ['devices'])).to.throw(RealAdbRefused);
        expect(() => childProcess.execFileSync(NO_SUCH_ADB, ['devices'])).to.throw(RealAdbRefused);
        expect(() => childProcess.exec(`${NO_SUCH_ADB} devices`)).to.throw(RealAdbRefused);
        expect(refused).to.deep.equal([
          `${NO_SUCH_ADB} devices`,
          `${NO_SUCH_ADB} devices`,
          `${NO_SUCH_ADB} devices`,
        ]);
        expect(
          childProcess.execFileSync(process.execPath, ['-e', 'process.stdout.write("ok")'], {
            encoding: 'utf8',
          }),
        ).to.equal('ok');
      } finally {
        release();
      }
    });

    it("puts child_process's own functions back once the last guard ends", () => {
      const spawn = childProcess.spawn;
      const outer = guard(() => undefined);
      const inner = guard(() => undefined);
      expect(childProcess.spawn).to.not.equal(spawn);
      inner();
      expect(childProcess.spawn, 'the outer guard still holds').to.not.equal(spawn);
      outer();
      expect(childProcess.spawn).to.equal(spawn);
    });
  });

  describe('forbidRealAdb, in a spec of its own', () => {
    it('fails the describe that ran adb, in a test or in a teardown, naming the command', () => {
      const { status, output } = runSpec(`
describe('a spec that reaches adb', function () {
  forbidRealAdb();
  afterEach(() => {
    try { cp.execFile(ADB, ['-s', 'R58M123', 'shell', 'settings', 'put', 'global', 'http_proxy', ':0'], () => {}); } catch (e) {}
  });
  after(() => {
    try { cp.spawn(ADB, ['-s', 'R58M123', 'shell', 'svc', 'data', 'enable']); } catch (e) {}
  });
  it('runs a radio command', () => {
    try { cp.spawn(ADB, ['-s', 'R58M123', 'shell', 'svc', 'wifi', 'disable']); } catch (e) {}
  });
});
`);
      expect(status, output).to.equal(1);
      expect(output).to.include('"after all" hook: no real adb was run');
      expect(output).to.include(`${NO_SUCH_ADB} -s R58M123 shell svc wifi disable`);
      expect(output, 'an afterEach').to.include('http_proxy :0');
      expect(output, "the describe's own after").to.include('svc data enable');
    });

    it('passes a describe that runs no adb, other programs included', () => {
      const { status, output } = runSpec(`
describe('a spec with a fake adb', function () {
  forbidRealAdb();
  it('runs node', () => { cp.execFileSync(process.execPath, ['-e', '0']); });
});
`);
      expect(status, output).to.equal(0);
    });
  });

  it('every spec under test/unit/phone-network and test/unit/interceptor carries the guard', () => {
    const dirs = ['test/unit/phone-network', 'test/unit/interceptor'];
    const missing = dirs.flatMap((dir) =>
      fs
        .readdirSync(path.join(REPO, dir))
        .filter((name) => /\.(spec|test)\.ts$/.test(name))
        .map((name) => path.join(dir, name))
        .filter((file) => !/\b(useFakeAdb|forbidRealAdb)\(/.test(read(file))),
    );
    expect(missing, 'call forbidRealAdb() (or useFakeAdb) in these').to.deep.equal([]);
  });
});

function read(file: string): string {
  return fs.readFileSync(path.join(REPO, file), 'utf8');
}
