import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { CertManager } from '../../../src/services/interceptor/CertManager';
import { MitmProxyHost } from '../../../src/services/interceptor/MitmProxyHost';
import { PortAllocator } from '../../../src/services/PortAllocator';
import { PhoneProxy } from '../../../src/services/network/PhoneProxy';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { config, updateConfig } from '../../../src/config';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

const PROXY_PORT = 11150;
const phone = { udid: 'R5CT', platform: 'android', deviceType: 'real', host: 'h' } as any;
const ON = { enabled: true, mocks: [], includeHosts: [], excludeHosts: [] };
const SET_PROXY = `shell settings put global http_proxy 127.0.0.1:${PROXY_PORT}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * A capture that fails part way through its start leaves nothing behind.
 * Through 2.36 a throw after the port lease (typically the adb call that sets
 * the phone's proxy) left the lease, the `adb reverse`, and a MITM proxy
 * listening on every interface, with no state for the session's end to stop.
 */
describe('InterceptorService: a start that fails part way', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let restoreRegs: () => void;
  let assetsBefore: string;
  let assetsDir: string;
  let ledger: PhoneNetworkLedger;
  let ports: {
    acquire: sinon.SinonStub;
    release: sinon.SinonStub;
    releaseForUdid: sinon.SinonStub;
  };
  let proxyStart: sinon.SinonStub;
  let proxyStop: sinon.SinonStub;

  beforeEach(async () => {
    adb = fakeAdb({ 'shell settings get global http_proxy': 'proxy.corp:3128' });
    restoreRegs = saveRegistrations(PortAllocator, PhoneProxy);
    ports = {
      acquire: sinon.stub().resolves(PROXY_PORT),
      release: sinon.stub().resolves(),
      releaseForUdid: sinon.stub().resolves(),
    };
    Container.set(PortAllocator, { ...ports, rangeOf: () => [11100, 11199] } as any);
    Container.set(PhoneProxy, new PhoneProxy());
    sinon.stub(CertManager.prototype, 'ensure').resolves({
      certPath: '/nonexistent/ca.pem',
      keyPath: '/nonexistent/ca.key',
      subjectHash: 'abc',
    });
    sinon.stub(CertManager.prototype, 'androidCertFilename').returns('abc.0');
    proxyStart = sinon.stub(MitmProxyHost.prototype, 'start').resolves();
    proxyStop = sinon.stub(MitmProxyHost.prototype, 'stop').resolves();
    assetsBefore = config.sessionAssetsPath;
    assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-icp-rollback-'));
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

  const failure = async (p: Promise<unknown>) => {
    let thrown: any;
    await p.catch((e) => (thrown = e));
    return thrown;
  };

  it("when the phone's proxy can't be set: proxy stopped, reverse removed, port released", async () => {
    adb.answers[SET_PROXY] = new Error("device 'R5CT' not found");
    const svc = new InterceptorService();

    const thrown = await failure(svc.start('s1', phone, ON));

    expect(String(thrown?.message)).to.include('not found');
    expect(svc.isActive('s1')).to.equal(false);
    expect(svc.hasCapture('s1')).to.equal(false);
    expect(svc.sessionIds()).to.deep.equal([]);
    expect(proxyStop.calledOnce, 'the MITM proxy is stopped').to.equal(true);
    expect(adb.commands('R5CT')).to.include(`reverse --remove tcp:${PROXY_PORT}`);
    expect(ports.release.calledOnceWith(PROXY_PORT, 'R5CT')).to.equal(true);
    expect(Container.get(PhoneProxy).owns('s1')).to.equal(false);
    // The phone's own proxy is written back, and the record settled.
    expect(adb.commands('R5CT')).to.include('shell settings put global http_proxy proxy.corp:3128');
    expect(await ledger.list()).to.deep.equal([]);
  });

  it("when the proxy can't start: reverse removed, port released, the phone untouched", async () => {
    proxyStart.rejects(new Error('EADDRINUSE'));
    const svc = new InterceptorService();

    const thrown = await failure(svc.start('s1', phone, ON));

    expect(String(thrown?.message)).to.include('EADDRINUSE');
    expect(svc.isActive('s1')).to.equal(false);
    expect(adb.commands('R5CT')).to.deep.equal([
      `reverse tcp:${PROXY_PORT} tcp:${PROXY_PORT}`,
      `reverse --remove tcp:${PROXY_PORT}`,
    ]);
    expect(ports.release.calledOnceWith(PROXY_PORT, 'R5CT')).to.equal(true);
    expect(await ledger.list()).to.deep.equal([]);
  });

  it('a session that ends while its capture starts stops it once the start is done', async () => {
    const gate = deferred();
    proxyStart.callsFake(() => gate.promise);
    const svc = new InterceptorService();

    const started = svc.start('s1', phone, ON);
    await new Promise((r) => setImmediate(r));
    expect(svc.hasCapture('s1'), 'a starting capture counts, so the end stops it').to.equal(true);
    expect(svc.isActive('s1'), 'its requests are not readable yet').to.equal(false);
    expect(svc.sessionIds()).to.deep.equal(['s1']);
    const stopped = svc.stop('s1');
    gate.resolve();
    await Promise.all([started, stopped]);

    expect(svc.isActive('s1')).to.equal(false);
    expect(proxyStop.calledOnce).to.equal(true);
    expect(adb.commands('R5CT')).to.include('shell settings put global http_proxy proxy.corp:3128');
    expect(await ledger.list()).to.deep.equal([]);
  });

  it('a second start while the first is still starting is skipped', async () => {
    const gate = deferred();
    proxyStart.callsFake(() => gate.promise);
    const svc = new InterceptorService();

    const first = svc.start('s1', phone, ON);
    await new Promise((r) => setImmediate(r));
    const second = svc.start('s1', phone, ON);
    gate.resolve();
    await Promise.all([first, second]);

    expect(ports.acquire.calledOnce).to.equal(true);
    await svc.stop('s1');
  });
});
