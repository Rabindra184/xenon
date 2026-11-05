import { expect } from 'chai';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import {
  checkGoIosBinary,
  GoIosCheckDeps,
  goIosBinaryPath,
  goIosStartupReport,
  goIosStateMessage,
  legacyGoIosBinaryPath,
} from '../../src/device-managers/ios/goIosBinary';

// go-ios ships inside the plugin from 2.18, beside the module that names it,
// so an install or upgrade of Xenon brings the go-ios it pins. Before that a
// separate installer put it under the home folder, where the boot reap still
// looks for go-ios an older Xenon left running.
//
// The binary is a Mac build. Off macOS it is reported as such rather than
// spawned, and an install that lost the executable bit gets one chmod before
// it is reported as unusable.

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
    expect(legacyGoIosBinaryPath()).to.equal(
      path.join(os.homedir(), '.cache', 'xenon', 'goIOS', 'ios'),
    );
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
    const makeExecutable = sinon.spy<(p: string) => void>(() => {
      x = true;
    });
    expect(checkGoIosBinary(BIN, deps({ isExecutable: () => x, makeExecutable }))).to.equal('ok');
    expect(makeExecutable.calledOnceWithExactly(BIN)).to.equal(true);
  });
  it('is not-executable when chmod fails', () => {
    const makeExecutable = () => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    };
    expect(checkGoIosBinary(BIN, deps({ isExecutable: () => false, makeExecutable }))).to.equal(
      'not-executable',
    );
  });
});

describe('what Xenon says about go-ios', () => {
  it('names the path and says to reinstall when missing', () => {
    expect(goIosStateMessage('missing', BIN)).to.equal(
      `go-ios is missing from this Xenon install (${BIN}). Reinstall the plugin.`,
    );
  });
  it('says so when it cannot be made executable', () => {
    expect(goIosStateMessage('not-executable', BIN)).to.equal(
      `go-ios at ${BIN} can't be run and couldn't be made executable. Reinstall the plugin.`,
    );
  });
  it('says iPhones need a Mac off macOS', () => {
    expect(goIosStateMessage('not-mac', BIN)).to.equal(
      'go-ios comes with Xenon for macOS only. iPhones need a Mac.',
    );
  });
  it('logs the bundled go-ios at start for ios and both, any case', () => {
    expect(goIosStartupReport('both', 'ok', BIN)).to.deep.equal({
      level: 'info',
      message: `go-ios v1.2.1 (comes with Xenon): ${BIN}`,
    });
    expect(goIosStartupReport('IOS', 'missing', BIN)).to.deep.equal({
      level: 'warn',
      message: goIosStateMessage('missing', BIN),
    });
  });
  it('logs nothing for android, or off macOS', () => {
    expect(goIosStartupReport('android', 'missing', BIN)).to.equal(null);
    expect(goIosStartupReport('both', 'not-mac', BIN)).to.equal(null);
  });
});
