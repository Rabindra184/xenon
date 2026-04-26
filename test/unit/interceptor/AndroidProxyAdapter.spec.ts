import { expect } from 'chai';
import sinon from 'sinon';
import { AndroidProxyAdapter } from '../../../src/services/interceptor/AndroidProxyAdapter';

interface FakeAdb {
  adbExec: sinon.SinonStub;
}

const makeAdb = (): FakeAdb => ({ adbExec: sinon.stub().resolves('') });

describe('AndroidProxyAdapter', () => {
  describe('setProxy', () => {
    it('writes global http_proxy via adb settings put', async () => {
      const adb = makeAdb();
      const adapter = new AndroidProxyAdapter(async () => adb as any);
      await adapter.setProxy('udid-1', '10.0.2.2', 8888);
      const args = adb.adbExec.firstCall.args[0];
      expect(args).to.deep.equal([
        '-s',
        'udid-1',
        'shell',
        'settings',
        'put',
        'global',
        'http_proxy',
        '10.0.2.2:8888',
      ]);
    });
  });

  describe('clearProxy', () => {
    it('resets global http_proxy to :0', async () => {
      const adb = makeAdb();
      const adapter = new AndroidProxyAdapter(async () => adb as any);
      await adapter.clearProxy('udid-1');
      const args = adb.adbExec.firstCall.args[0];
      expect(args).to.deep.equal([
        '-s',
        'udid-1',
        'shell',
        'settings',
        'put',
        'global',
        'http_proxy',
        ':0',
      ]);
    });
  });

  describe('installCaCert', () => {
    it('user mode: pushes cert to /sdcard/ and triggers install intent', async () => {
      const adb = makeAdb();
      const adapter = new AndroidProxyAdapter(async () => adb as any);
      await adapter.installCaCert('udid-1', '/tmp/ca.pem', 'abc12345.0', 'user');
      const calls = adb.adbExec.getCalls();
      const pushCall = calls.find((c) => c.args[0][2] === 'push');
      expect(pushCall, 'expected adb push').to.not.equal(undefined);
      expect(pushCall!.args[0]).to.deep.equal([
        '-s',
        'udid-1',
        'push',
        '/tmp/ca.pem',
        '/sdcard/abc12345.0',
      ]);
    });

    it('system mode: roots, remounts, and pushes to /system/etc/security/cacerts', async () => {
      const adb = makeAdb();
      const adapter = new AndroidProxyAdapter(async () => adb as any);
      await adapter.installCaCert('udid-1', '/tmp/ca.pem', 'abc12345.0', 'system');
      const calls = adb.adbExec.getCalls();
      const argsList = calls.map((c) => c.args[0]);
      const flatArgs = argsList.map((a) => a.join(' '));
      expect(flatArgs.some((s) => s.includes('root'))).to.equal(true);
      expect(flatArgs.some((s) => s.includes('remount'))).to.equal(true);
      const pushArgs = argsList.find((a) => a.includes('push'));
      expect(pushArgs).to.deep.equal([
        '-s',
        'udid-1',
        'push',
        '/tmp/ca.pem',
        '/system/etc/security/cacerts/abc12345.0',
      ]);
    });
  });

  describe('addReverse', () => {
    it('runs adb reverse tcp:{devicePort} tcp:{hostPort}', async () => {
      const adb = makeAdb();
      const adapter = new AndroidProxyAdapter(async () => adb as any);
      await adapter.addReverse('udid-1', 8888, 8888);
      expect(adb.adbExec.firstCall.args[0]).to.deep.equal([
        '-s',
        'udid-1',
        'reverse',
        'tcp:8888',
        'tcp:8888',
      ]);
    });

    it('supports asymmetric device/host ports', async () => {
      const adb = makeAdb();
      const adapter = new AndroidProxyAdapter(async () => adb as any);
      await adapter.addReverse('udid-1', 9000, 12345);
      expect(adb.adbExec.firstCall.args[0]).to.deep.equal([
        '-s',
        'udid-1',
        'reverse',
        'tcp:9000',
        'tcp:12345',
      ]);
    });
  });

  describe('removeReverse', () => {
    it('runs adb reverse --remove tcp:{devicePort}', async () => {
      const adb = makeAdb();
      const adapter = new AndroidProxyAdapter(async () => adb as any);
      await adapter.removeReverse('udid-1', 8888);
      expect(adb.adbExec.firstCall.args[0]).to.deep.equal([
        '-s',
        'udid-1',
        'reverse',
        '--remove',
        'tcp:8888',
      ]);
    });
  });

  describe('selectInstallMode', () => {
    it('returns "system" for emulator devices', () => {
      const mode = AndroidProxyAdapter.selectInstallMode({
        deviceType: 'emulator',
        realDevice: false,
      } as any);
      expect(mode).to.equal('system');
    });
    it('returns "user" for real devices', () => {
      const mode = AndroidProxyAdapter.selectInstallMode({
        deviceType: 'real',
        realDevice: true,
      } as any);
      expect(mode).to.equal('user');
    });
  });
});
