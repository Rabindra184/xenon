import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import Adb from '@devicefarmer/adbkit';
import { ADB as AppiumADB } from 'appium-adb';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { createTestAndroidManager, resetTestContainer } from '../helpers/test-container';

const RETRY_MS = 60_000;

/**
 * When adb couldn't be started, or its device tracking couldn't, the server
 * logged "Could not find ADB" without the reason and never looked again: every
 * later discovery answered no phones until a restart, even once adb worked
 * (an SDK installed, a stuck adb server killed). It now says why, and tries
 * again a minute later.
 */
describe('Android discovery when adb is unavailable', () => {
  const sandbox = sinon.createSandbox();
  let manager: AndroidDeviceManager;
  let createADB: sinon.SinonStub;
  let trackDevices: sinon.SinonStub;
  let errors: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;
  let savedNodeEnv: string | undefined;

  const workingAdb = () => ({
    adbRemoteHost: null,
    getConnectedDevices: sandbox.stub().resolves([]),
  });

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
    clock = sandbox.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    createADB = sandbox.stub(AppiumADB, 'createADB');
    trackDevices = sandbox.stub().resolves({ on: sandbox.stub() });
    sandbox.stub(Adb, 'createClient').returns({ trackDevices } as any);
    manager = createTestAndroidManager({ platform: 'android' });
    sandbox.stub(manager as any, 'requireSdkRoot').resolves();
    errors = sandbox.stub((manager as any).log, 'error');
  });

  afterEach(async () => {
    sandbox.restore();
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    await resetTestContainer();
  });

  const discover = () => manager.getDevices({ androidDeviceType: 'both' }, []);

  it('says why adb could not be started', async () => {
    createADB.rejects(new Error('Could not find adb. spawn adb ENOENT'));

    expect(await discover()).to.deep.equal([]);

    const logged = errors.getCalls().map((c) => String(c.args[0]));
    expect(
      logged.some((m) => m.includes('spawn adb ENOENT')),
      logged.join('\n'),
    ).to.equal(true);
  });

  it('tries adb again a minute later, and not before', async () => {
    const adb = workingAdb();
    createADB.onFirstCall().rejects(new Error('spawn adb ENOENT'));
    createADB.onSecondCall().resolves(adb);

    await discover();
    clock.tick(RETRY_MS - 1_000);
    await discover();
    expect(createADB.callCount, 'within the minute').to.equal(1);

    clock.tick(2_000);
    await discover();
    expect(createADB.callCount, 'after the minute').to.equal(2);
    expect(adb.getConnectedDevices.called, 'discovery ran').to.equal(true);
  });

  it('says why device tracking failed, keeps listing phones, and tries it again', async () => {
    process.env.NODE_ENV = 'development';
    const adb = workingAdb();
    createADB.resolves(adb);
    trackDevices.onFirstCall().rejects(new Error('connect ECONNREFUSED 127.0.0.1:5037'));

    await discover();
    const logged = errors.getCalls().map((c) => String(c.args[0]));
    expect(
      logged.some((m) => m.includes('ECONNREFUSED')),
      logged.join('\n'),
    ).to.equal(true);

    await discover();
    expect(adb.getConnectedDevices.callCount, 'phones still listed').to.equal(2);
    expect(trackDevices.callCount, 'within the minute').to.equal(1);

    clock.tick(RETRY_MS + 1_000);
    await discover();
    expect(trackDevices.callCount, 'after the minute').to.equal(2);
  });

  it('starts one device tracker when two discoveries start adb at once', async () => {
    // Each tracker runs the whole plug-in handling again for every phone
    // plugged in, and nothing could end the extra one.
    process.env.NODE_ENV = 'development';
    createADB.resolves(workingAdb());
    const pending: Array<() => void> = [];
    trackDevices.callsFake(
      () => new Promise((resolve) => pending.push(() => resolve({ on: sandbox.stub() }))),
    );

    const both = Promise.all([discover(), discover()]);
    while (pending.length === 0) await new Promise((r) => setImmediate(r));
    // Time for a second discovery to reach the tracker too, if it would.
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    pending.forEach((start) => start());
    await both;

    expect(createADB.callCount, 'adb started').to.equal(1);
    expect(trackDevices.callCount, 'trackers started').to.equal(1);
  });
});
