import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  ANDROID_SHELL_COMMANDS,
  IOS_SIMULATOR_COMMANDS,
  parseShellCommand,
} from '../../src/device-managers/shellCommands';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';

// The device control Shell tab's allow-list was a `startsWith` test, and the
// command then reached the phone's `sh`: `ls; reboot`, `ls && pm uninstall …`
// and `lsof` all ran. A command now has to be an allowed command word for word,
// and its arguments may only use characters a shell gives no meaning to.

describe('parseShellCommand', () => {
  const allowed = (cmd: string) => parseShellCommand(cmd, ANDROID_SHELL_COMMANDS);

  it('accepts an allowed command and its plain arguments', () => {
    expect(allowed('ls -la /sdcard/Download')).to.deep.equal({
      argv: ['ls', '-la', '/sdcard/Download'],
    });
    expect(allowed('  getprop   ro.product.model ')).to.deep.equal({
      argv: ['getprop', 'ro.product.model'],
    });
    expect(allowed('pm list packages -3')).to.deep.equal({
      argv: ['pm', 'list', 'packages', '-3'],
    });
    expect(allowed('dumpsys battery')).to.deep.equal({ argv: ['dumpsys', 'battery'] });
    expect(allowed('date +%s')).to.deep.equal({ argv: ['date', '+%s'] });
  });

  for (const cmd of [
    'ls; reboot',
    'ls;reboot',
    'ls && pm uninstall com.example.app',
    'ls || reboot',
    'ls | sh',
    'ls `reboot`',
    'getprop $(reboot)',
    'ls > /sdcard/x',
    'ls < /sdcard/x',
    'ls &',
    'ls\nreboot',
    "ls 'a b'",
    'ls "a b"',
    'ls \\; reboot',
    'getprop ${PATH}',
    'ls *',
    'ls ~',
  ]) {
    it(`refuses a shell metacharacter: ${JSON.stringify(cmd)}`, () => {
      expect(allowed(cmd)).to.have.property('refused');
    });
  }

  it('refuses a command that only starts like an allowed one', () => {
    expect(allowed('lsof')).to.have.property('refused');
    expect(allowed('pstree')).to.have.property('refused');
    expect(allowed('dumpsys batteryproperties')).to.have.property('refused');
    expect(allowed('pm list packagesx')).to.have.property('refused');
  });

  it('refuses arguments to a command that takes none', () => {
    expect(allowed('dumpsys battery set level 5')).to.have.property('refused');
    expect(allowed('cat /proc/meminfo /data/system/users/0.xml')).to.have.property('refused');
    expect(allowed('whoami --help')).to.have.property('refused');
  });

  it('refuses an empty command and anything not listed', () => {
    expect(allowed('   ')).to.have.property('refused');
    expect(allowed('reboot')).to.have.property('refused');
    expect(allowed('pm uninstall com.example.app')).to.have.property('refused');
    expect(allowed('cat /data/system/users/0.xml')).to.have.property('refused');
  });

  it('keeps every command the Android allow-list offered usable', () => {
    for (const cmd of [
      'ls',
      'ps -A',
      'top -n 1',
      'dumpsys battery',
      'dumpsys wifi',
      'dumpsys power',
      'whoami',
      'getprop',
      'pm list packages',
      'ip addr',
      'cat /proc/meminfo',
      'cat /proc/cpuinfo',
      'date',
      'uptime',
      'netstat -tn',
    ]) {
      expect(allowed(cmd), cmd).to.have.property('argv');
    }
  });

  it("lets a simulator's generic commands take no arguments", () => {
    expect(parseShellCommand('ls', IOS_SIMULATOR_COMMANDS)).to.have.property('argv');
    expect(parseShellCommand('ls /Users', IOS_SIMULATOR_COMMANDS)).to.have.property('refused');
  });
});

describe('AndroidDeviceManager.executeShell', () => {
  afterEach(() => sinon.restore());

  function managerWithAdb() {
    const manager = new AndroidDeviceManager({} as any);
    const adbExec = sinon.stub().resolves('ok');
    sinon.stub(manager as any, 'getAdb').resolves({ adbInstance: { adbExec } });
    return { manager, adbExec };
  }

  it('passes an allowed command to adb shell word by word', async () => {
    const { manager, adbExec } = managerWithAdb();
    expect(await manager.executeShell('R5CT32ABCDE', 'getprop ro.product.model')).to.equal('ok');
    expect(adbExec.firstCall.args[0]).to.deep.equal([
      '-s',
      'R5CT32ABCDE',
      'shell',
      'getprop',
      'ro.product.model',
    ]);
  });

  it('never reaches adb for a refused command', async () => {
    const { manager, adbExec } = managerWithAdb();
    for (const cmd of ['ls; reboot', 'lsof', 'dumpsys battery set level 5']) {
      const err = await manager.executeShell('R5CT32ABCDE', cmd).then(
        () => null,
        (e: Error) => e,
      );
      expect(err, cmd).to.be.an('Error');
      expect(err?.message, cmd).to.match(/not allowed/);
    }
    expect(adbExec.called).to.equal(false);
  });
});
