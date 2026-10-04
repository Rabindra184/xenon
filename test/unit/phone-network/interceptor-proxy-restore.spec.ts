import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { CertManager } from '../../../src/services/interceptor/CertManager';
import { MitmProxyHost } from '../../../src/services/interceptor/MitmProxyHost';
import { PortAllocator } from '../../../src/services/PortAllocator';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { config, updateConfig } from '../../../src/config';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

const PROXY_PORT = 11150;
const phone = { udid: 'R5CT', platform: 'android', deviceType: 'real', host: 'h' } as any;
const ON = { enabled: true, mocks: [], includeHosts: [], excludeHosts: [] };

/**
 * The interceptor points the whole phone at its proxy. When the session ends
 * it puts back the proxy the phone had (Xenon used to write ":0" over a lab's
 * own proxy), and records the change while it lasts so a restart can undo it.
 */
describe('InterceptorService and the phone proxy', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let restoreRegs: () => void;
  let assetsBefore: string;
  let assetsDir: string;
  let ledger: PhoneNetworkLedger;
  let range: [number, number];

  beforeEach(async () => {
    adb = fakeAdb({ 'shell settings get global http_proxy': 'proxy.corp:3128' });
    restoreRegs = saveRegistrations(PortAllocator);
    range = [11100, 11199];
    Container.set(PortAllocator, {
      acquire: async () => PROXY_PORT,
      releaseForUdid: async () => undefined,
      rangeOf: () => range,
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
    assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-icp-'));
    updateConfig({ sessionAssetsPath: assetsDir });
    ledger = new PhoneNetworkLedger();
    for (const entry of await ledger.list()) await ledger.forget(entry.sessionId);
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
    updateConfig({ sessionAssetsPath: assetsBefore });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  it('reads the proxy the phone had and writes its own down before setting it', async () => {
    const svc = new InterceptorService();
    await svc.start('s1', phone, ON);

    const cmds = adb.commands('R5CT');
    const read = cmds.indexOf('shell settings get global http_proxy');
    const set = cmds.indexOf(`shell settings put global http_proxy 127.0.0.1:${PROXY_PORT}`);
    expect(read, cmds.join('\n')).to.be.greaterThan(-1);
    expect(set).to.be.greaterThan(read);
    const [entry] = await ledger.list();
    expect(entry).to.include({ sessionId: 's1', udid: 'R5CT' });
    expect(entry.proxy).to.deep.equal({
      set: `127.0.0.1:${PROXY_PORT}`,
      previous: 'proxy.corp:3128',
      reversePort: PROXY_PORT,
    });
    await svc.stop('s1');
  });

  it("puts the phone's own proxy back at the end, and saves the capture", async () => {
    const svc = new InterceptorService();
    await svc.start('s1', phone, ON);
    adb.calls.length = 0;

    await svc.stop('s1');

    expect(adb.commands('R5CT')).to.include('shell settings put global http_proxy proxy.corp:3128');
    expect(adb.commands('R5CT')).not.to.include('shell settings put global http_proxy :0');
    expect(await ledger.list()).to.deep.equal([]);
    expect(fs.existsSync(path.join(assetsDir, 's1', 'interceptor', 'requests.json'))).to.equal(
      true,
    );
  });

  it('clears the proxy at the end when the phone had none', async () => {
    adb.answers['shell settings get global http_proxy'] = ':0';
    const svc = new InterceptorService();
    await svc.start('s1', phone, ON);
    adb.calls.length = 0;

    await svc.stop('s1');

    expect(adb.commands('R5CT')).to.include('shell settings put global http_proxy :0');
  });

  it("doesn't put back a proxy an earlier run left pointing at a dead capture port", async () => {
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    const dead = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    range = [Math.min(dead, PROXY_PORT), Math.max(dead, PROXY_PORT)];
    adb.answers['shell settings get global http_proxy'] = `127.0.0.1:${dead}`;
    const svc = new InterceptorService();
    await svc.start('s1', phone, ON);
    adb.calls.length = 0;

    await svc.stop('s1');

    expect(adb.commands('R5CT')).to.include('shell settings put global http_proxy :0');
    expect(adb.commands('R5CT')).not.to.include(
      `shell settings put global http_proxy 127.0.0.1:${dead}`,
    );
  });

  it('keeps the record when the proxy could not be put back', async () => {
    const svc = new InterceptorService();
    await svc.start('s1', phone, ON);
    adb.answers['shell settings put global http_proxy proxy.corp:3128'] = new Error('offline');

    await svc.stop('s1');

    expect((await ledger.list()).map((e) => e.sessionId)).to.deep.equal(['s1']);
    expect(svc.isActive('s1')).to.equal(false);
  });

  it('stops once, however many times it is asked', async () => {
    const svc = new InterceptorService();
    await svc.start('s1', phone, ON);
    adb.calls.length = 0;

    await Promise.all([svc.stop('s1'), svc.stop('s1')]);

    const puts = adb.commands('R5CT').filter((c) => c.startsWith('shell settings put'));
    expect(puts).to.deep.equal(['shell settings put global http_proxy proxy.corp:3128']);
  });
});
