import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { prisma } from '../../../src/prisma';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { CertManager } from '../../../src/services/interceptor/CertManager';
import { MitmProxyHost } from '../../../src/services/interceptor/MitmProxyHost';
import { PortAllocator } from '../../../src/services/PortAllocator';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { config, updateConfig } from '../../../src/config';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

const PROXY_PORT = 11150;
const ON = { enabled: true, mocks: [], includeHosts: [], excludeHosts: [] };
const realPhone = { udid: 'R5CT', platform: 'android', deviceType: 'real', host: 'h' } as any;
const emulator = {
  udid: 'emulator-5554',
  platform: 'android',
  deviceType: 'emulator',
  realDevice: false,
  host: 'h',
} as any;
const USER_PATH = '/sdcard/abc.0';
const SYSTEM_PATH = '/system/etc/security/cacerts/abc.0';

/**
 * The interceptor puts its CA certificate on the phone (the system store of
 * an emulator, after `adb root` and `remount`; the SD card of a real phone).
 * Through 2.36 it never took it off: every phone that had a capture kept
 * Xenon's CA. Now the install is written down first, in the session's
 * network record, and the certificate is removed when the capture stops, or
 * at the next start for one a crash left.
 */
describe('InterceptorService: the CA certificate it puts on the phone', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let restoreRegs: () => void;
  let assetsBefore: string;
  let assetsDir: string;
  let ledger: PhoneNetworkLedger;

  beforeEach(async () => {
    adb = fakeAdb({
      'shell settings get global http_proxy': ':0',
      [`shell ls ${USER_PATH}`]: new Error(`ls: ${USER_PATH}: No such file or directory`),
      [`shell ls ${SYSTEM_PATH}`]: new Error(`ls: ${SYSTEM_PATH}: No such file or directory`),
      'shell id -u': '2000',
    });
    restoreRegs = saveRegistrations(PortAllocator);
    Container.set(PortAllocator, {
      acquire: async () => PROXY_PORT,
      release: async () => undefined,
      rangeOf: () => [11100, 11199],
    } as any);
    sinon.stub(CertManager.prototype, 'ensure').resolves({
      certPath: '/nonexistent/ca.pem',
      keyPath: '/nonexistent/ca.key',
      subjectHash: 'abc',
    });
    sinon.stub(CertManager.prototype, 'androidCertFilename').returns('abc.0');
    sinon.stub(MitmProxyHost.prototype, 'start').resolves();
    sinon.stub(MitmProxyHost.prototype, 'stop').resolves();
    assetsBefore = config.sessionAssetsPath;
    assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-icp-ca-'));
    updateConfig({ sessionAssetsPath: assetsDir });
    ledger = new PhoneNetworkLedger();
    await prisma.webConfig.deleteMany({ where: { name: { startsWith: 'phone-network:' } } });
  });

  afterEach(async () => {
    sinon.restore();
    restoreRegs();
    updateConfig({ sessionAssetsPath: assetsBefore });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  describe('a real phone', () => {
    it('writes the install down before pushing the certificate', async () => {
      const pushesAtNote: number[] = [];
      const note = PhoneNetworkLedger.prototype.note;
      sinon.stub(PhoneNetworkLedger.prototype, 'note').callsFake(async function (
        this: PhoneNetworkLedger,
        ...args: any[]
      ) {
        if ((args[2] as any).caCert) {
          pushesAtNote.push(adb.commands('R5CT').filter((c) => c.startsWith('push')).length);
        }
        return (note as any).apply(this, args);
      });
      const svc = new InterceptorService();
      await svc.start('s1', realPhone, ON);

      expect(adb.commands('R5CT')).to.include(`push /nonexistent/ca.pem ${USER_PATH}`);
      expect(pushesAtNote).to.deep.equal([0]);
      const [entry] = await ledger.list();
      expect(entry.caCert).to.deep.equal({ mode: 'user', file: 'abc.0', rootedByXenon: false });
      await svc.stop('s1');
    });

    it('removes the certificate when the capture stops, and settles the record', async () => {
      const svc = new InterceptorService();
      await svc.start('s1', realPhone, ON);
      adb.calls.length = 0;

      await svc.stop('s1');

      expect(adb.commands('R5CT')).to.include(`shell rm -f ${USER_PATH}`);
      expect(await ledger.list()).to.deep.equal([]);
    });

    it("leaves a certificate that was there before the capture: it isn't Xenon's to take", async () => {
      adb.answers[`shell ls ${USER_PATH}`] = USER_PATH;
      const svc = new InterceptorService();
      await svc.start('s1', realPhone, ON);
      expect((await ledger.list()).map((e) => e.caCert)).to.deep.equal([undefined]);
      adb.calls.length = 0;

      await svc.stop('s1');

      expect(adb.commands('R5CT').filter((c) => c.includes(' rm '))).to.deep.equal([]);
    });

    it('keeps the record when the phone cannot be reached, and the next start removes it', async () => {
      const svc = new InterceptorService();
      await svc.start('s1', realPhone, ON);
      adb.answers[`shell rm -f ${USER_PATH}`] = new Error("device 'R5CT' not found");

      await svc.stop('s1');

      const [kept] = await ledger.list();
      expect(kept.caCert).to.deep.equal({ mode: 'user', file: 'abc.0', rootedByXenon: false });
      delete adb.answers[`shell rm -f ${USER_PATH}`];
      adb.calls.length = 0;

      expect(await new PhoneNetworkRestore().restoreLeftovers({})).to.equal(1);
      expect(adb.commands('R5CT')).to.include(`shell rm -f ${USER_PATH}`);
      expect(await ledger.list()).to.deep.equal([]);
    });

    it('a start that fails after the install takes the certificate off again', async () => {
      adb.answers[`shell settings put global http_proxy 127.0.0.1:${PROXY_PORT}`] = new Error(
        'device offline',
      );
      const svc = new InterceptorService();
      let thrown: any;
      await svc.start('s1', realPhone, ON).catch((e) => (thrown = e));

      expect(thrown).to.be.instanceOf(Error);
      expect(adb.commands('R5CT')).to.include(`shell rm -f ${USER_PATH}`);
      expect((await ledger.list()).map((e) => e.caCert)).to.deep.equal([]);
    });
  });

  describe('an emulator (the system store)', () => {
    it('records that Xenon turned root on, removes the certificate, and leaves adbd as root', async () => {
      const svc = new InterceptorService();
      await svc.start('s1', emulator, ON);
      const cmds = adb.commands('emulator-5554');
      expect(cmds).to.include('root');
      expect(cmds).to.include(`push /nonexistent/ca.pem ${SYSTEM_PATH}`);
      const [entry] = await ledger.list();
      expect(entry.caCert).to.deep.equal({ mode: 'system', file: 'abc.0', rootedByXenon: true });
      // adbd is root from then on.
      adb.answers['shell id -u'] = '0';
      adb.calls.length = 0;

      await svc.stop('s1');

      const after = adb.commands('emulator-5554');
      expect(after).to.include('remount');
      expect(after).to.include(`shell rm -f ${SYSTEM_PATH}`);
      expect(after.indexOf('remount')).to.be.lessThan(after.indexOf(`shell rm -f ${SYSTEM_PATH}`));
      // `adb unroot` restarts adbd, which ends the driver's instrumentation,
      // its port forwards and any screen recording while the session ends.
      expect(after).not.to.include('unroot');
      expect(await ledger.list()).to.deep.equal([]);
    });

    it("doesn't restart adbd when it already runs as root", async () => {
      adb.answers['shell id -u'] = '0';
      const svc = new InterceptorService();
      await svc.start('s1', emulator, ON);

      expect(adb.commands('emulator-5554')).not.to.include('root');
      const [entry] = await ledger.list();
      expect(entry.caCert).to.deep.equal({ mode: 'system', file: 'abc.0', rootedByXenon: false });
      adb.calls.length = 0;

      await svc.stop('s1');

      expect(adb.commands('emulator-5554')).not.to.include('root');
      expect(adb.commands('emulator-5554')).to.include(`shell rm -f ${SYSTEM_PATH}`);
    });
  });

  // Removal runs before the driver's own delete, and at the next session's
  // start after the driver is up: `adb root` would restart adbd under it.
  it('an emulator that lost root keeps its record until this server starts again', async () => {
    const svc = new InterceptorService();
    await svc.start('s1', emulator, ON);
    adb.calls.length = 0;

    await svc.stop('s1');

    expect(adb.commands('emulator-5554')).not.to.include('root');
    expect(adb.commands('emulator-5554').filter((c) => c.includes(' rm '))).to.deep.equal([]);
    expect((await ledger.list()).map((e) => e.sessionId)).to.deep.equal(['s1']);

    await new PhoneNetworkRestore().restoreLeftovers({ udid: 'emulator-5554' });
    expect(adb.commands('emulator-5554')).not.to.include('root');
    expect((await ledger.list()).map((e) => e.sessionId)).to.deep.equal(['s1']);
    adb.calls.length = 0;

    await new PhoneNetworkRestore().cleanUpAtBoot([]);

    expect(adb.commands('emulator-5554')).to.deep.equal([
      'shell id -u',
      'root',
      'wait-for-device',
      'remount',
      `shell rm -f ${SYSTEM_PATH}`,
    ]);
    expect(await ledger.list()).to.deep.equal([]);
  });

  describe('the record', () => {
    const row = (value: object) =>
      prisma.webConfig.create({
        data: { id: 'phone-network:old', name: 'phone-network:old', value: JSON.stringify(value) },
      });

    it('a leftover from a crash is removed at the next start', async () => {
      await row({
        v: 1,
        sessionId: 'old',
        udid: 'R5CT',
        at: Date.now(),
        caCert: { mode: 'user', file: 'abc.0', rootedByXenon: false },
      });

      expect(await new PhoneNetworkRestore().restoreLeftovers({})).to.equal(1);

      expect(adb.commands('R5CT')).to.deep.equal([`shell rm -f ${USER_PATH}`]);
      expect(await ledger.list()).to.deep.equal([]);
    });

    it('never runs a file name that is not a certificate file name', async () => {
      await row({
        v: 1,
        sessionId: 'old',
        udid: 'R5CT',
        at: Date.now(),
        caCert: { mode: 'user', file: 'abc.0; reboot', rootedByXenon: false },
      });

      await new PhoneNetworkRestore().restoreLeftovers({});

      expect(adb.calls).to.deep.equal([]);
      // Kept, as a row this release can't read is.
      const left = await prisma.webConfig.findMany({ where: { name: 'phone-network:old' } });
      expect(left).to.have.length(1);
    });
  });
});
