import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { ADB } from 'appium-adb';
import { ServerManager } from '../../src/services/ServerManager';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';

/**
 * `emulators` lists Android emulators (AVDs) for the server to boot at
 * startup, with the launch options each one needs. It used to boot them only
 * when `platform` was exactly an Android one, so with the default `both` it
 * booted nothing, and schema.json described it as an allow-list that
 * discovery never applied. Discovery is not filtered by it: a booted emulator
 * is found like any other.
 */
describe('booting the configured emulators', () => {
  afterEach(() => sinon.restore());

  function args(over: Partial<IPluginArgs>): IPluginArgs {
    return { ...DefaultPluginArgs, ...over } as IPluginArgs;
  }

  function fakeAdb(launch?: (avd: string) => Promise<unknown>) {
    const launchAVD = sinon.stub().callsFake(launch ?? (async () => undefined));
    const createADB = sinon.stub(ADB, 'createADB').resolves({ launchAVD } as any);
    return { launchAVD, createADB };
  }

  const boot = (pluginArgs: IPluginArgs) =>
    (Container.get(ServerManager) as any).bootEmulators(pluginArgs) as Promise<void>;

  const EMULATORS = [
    { avdName: 'Pixel_7', args: ['-no-snapshot-load'] },
    { avdName: 'Pixel_Tablet' },
  ];

  it('boots them when the platform is android', async () => {
    const { launchAVD } = fakeAdb();
    await boot(args({ platform: 'android', emulators: EMULATORS }));
    expect(launchAVD.args.map((a) => a[0])).to.have.members(['Pixel_7', 'Pixel_Tablet']);
  });

  it('boots them when the platform is both, the default', async () => {
    const { launchAVD } = fakeAdb();
    await boot(args({ platform: 'both', emulators: EMULATORS }));
    expect(launchAVD.args.map((a) => a[0])).to.have.members(['Pixel_7', 'Pixel_Tablet']);
  });

  it("passes each emulator's own launch options on", async () => {
    const { launchAVD } = fakeAdb();
    await boot(args({ platform: 'both', emulators: EMULATORS }));
    const pixel = launchAVD.args.find((a) => a[0] === 'Pixel_7');
    expect(pixel?.[1]).to.include({ avdName: 'Pixel_7' });
    expect(pixel?.[1].args).to.deep.equal(['-no-snapshot-load']);
  });

  it('boots nothing for an iOS-only server', async () => {
    const { launchAVD, createADB } = fakeAdb();
    await boot(args({ platform: 'ios', emulators: EMULATORS }));
    expect(createADB.called).to.equal(false);
    expect(launchAVD.called).to.equal(false);
  });

  it('boots nothing when only real Android devices are wanted', async () => {
    const { launchAVD } = fakeAdb();
    await boot(args({ platform: 'both', androidDeviceType: 'real', emulators: EMULATORS }));
    expect(launchAVD.called).to.equal(false);
  });

  it('boots nothing when none is listed', async () => {
    const { launchAVD, createADB } = fakeAdb();
    await boot(args({ platform: 'both', emulators: [] }));
    expect(createADB.called).to.equal(false);
    expect(launchAVD.called).to.equal(false);
  });

  it('does not stop the server from starting when one emulator will not boot', async () => {
    const { launchAVD } = fakeAdb(async (avd) => {
      if (avd === 'Pixel_7') throw new Error('Emulator is not ready');
    });
    await boot(args({ platform: 'both', emulators: EMULATORS }));
    expect(launchAVD.args.map((a) => a[0])).to.have.members(['Pixel_7', 'Pixel_Tablet']);
  });

  it('does not stop the server from starting when there is no Android SDK', async () => {
    sinon.stub(ADB, 'createADB').rejects(new Error('ANDROID_HOME is not set'));
    await boot(args({ platform: 'both', emulators: EMULATORS }));
  });
});
