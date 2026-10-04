import 'reflect-metadata';
import { expect } from 'chai';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { XenonDatabase } from '../../src/data-service/db';
import { resetDevicesAtBoot } from '../../src/data-service/deviceSettings';
import { localDeviceHosts } from '../../src/device-managers/localDeviceHosts';
import { IDevice } from '../../src/interfaces/IDevice';
import { useLokiStores } from '../helpers/loki-stores';

/**
 * The in-memory store keeps a phone's settings apart from its row as the
 * Prisma store does (device-settings-survive.spec.ts runs the real one).
 */

const IP = '10.0.0.1';
const OWN = `http://${IP}:4723`;
const NODE = `http://${IP}:4725`;
const local = localDeviceHosts({ bindHostOrIp: IP }, 4723);

const phone = (udid: string, host = OWN, over: Partial<IDevice> = {}): IDevice =>
  ({
    udid,
    host,
    name: udid,
    platform: 'android',
    deviceType: 'real',
    realDevice: true,
    state: 'device',
    sdk: '14',
    busy: false,
    userBlocked: false,
    offline: false,
    totalUtilizationTimeMilliSec: 0,
    sessionStartTime: 0,
    ...over,
  }) as IDevice;

describe('Saved phone settings in the in-memory store', () => {
  useLokiStores();
  const store = () => DeviceStoreFactory.getStore();

  const empty = async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    (await XenonDatabase.DeviceSettingsModel).removeDataOnly();
  };
  beforeEach(empty);
  after(empty);

  const configure = (udid: string, host = OWN) =>
    store().updateDevice(udid, host, { teamId: 'team-a', tags: ['lab-1'], userBlocked: true });

  it('a phone removed and added again keeps them', async () => {
    await store().addDevices([phone('p1')]);
    await configure('p1');

    await store().removeDevices({ udid: 'p1', host: OWN });
    const [back] = await store().addDevices([phone('p1')]);

    expect(back).to.include({ teamId: 'team-a', userBlocked: true });
    expect(back.tags).to.deep.equal(['lab-1']);
  });

  it('keeps them across a restart, and saves those kept only on a row', async () => {
    await store().addDevices([phone('p1'), phone('legacy', OWN, { teamId: 'team-b' })]);
    await configure('p1');

    await resetDevicesAtBoot(
      store(),
      { removeDevicesFromDatabaseBeforeRunningThePlugin: false },
      local,
    );
    expect(await store().getAllDevices()).to.deep.equal([]);
    await store().addDevices([phone('p1'), phone('legacy')]);

    expect(await store().findDevice({ udid: 'p1', host: OWN })).to.include({ teamId: 'team-a' });
    expect(await store().findDevice({ udid: 'legacy', host: OWN })).to.include({
      teamId: 'team-b',
    });
  });

  it('gives a node’s phone the hub’s settings, never its report’s or another host’s', async () => {
    await store().addDevices([phone('emulator-5554')]);
    await configure('emulator-5554');
    await store().addDevices([phone('node-phone', NODE)], { nodeReport: true });
    await store().updateDevice('node-phone', NODE, { teamId: 'team-a' });
    await store().removeDevices({ udid: 'node-phone', host: NODE });

    await store().addDevices(
      [
        phone('node-phone', NODE, { teamId: 'team-b', userBlocked: true }),
        phone('emulator-5554', NODE),
      ],
      { nodeReport: true },
    );

    expect(await store().findDevice({ udid: 'node-phone', host: NODE })).to.include({
      teamId: 'team-a',
      userBlocked: false,
    });
    const nodeEmulator = await store().findDevice({ udid: 'emulator-5554', host: NODE });
    expect(nodeEmulator?.teamId ?? null).to.equal(null);
    expect(nodeEmulator?.userBlocked ?? false).to.equal(false);
  });

  it('lists the saved phones of a udid, and forgets those of the hosts named', async () => {
    await store().updateDevice('p1', OWN, { userBlocked: true });
    await store().updateDevice('p1', NODE, { userBlocked: true });

    expect(await store().findSavedPhones('p1')).to.have.deep.members([
      { udid: 'p1', host: OWN },
      { udid: 'p1', host: NODE },
    ]);
    await store().forgetSettings([OWN]);
    expect(await store().findSavedPhones('p1')).to.deep.equal([{ udid: 'p1', host: NODE }]);
  });
});
