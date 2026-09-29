import 'reflect-metadata';
import { expect } from 'chai';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

/**
 * clearStorage(onlyHosts) on the in-memory (Loki) store, the one the unit
 * suite runs: a hub starting up forgets its own phones and keeps its nodes'.
 * The Prisma store's side is in session-recovery-routing.spec.ts.
 */
describe('LokiDeviceStore.clearStorage(onlyHosts)', () => {
  const HUB = 'http://clear-at-boot-hub:4724';
  const NODE = 'http://clear-at-boot-hub:4725';
  let savedStore: unknown;
  let store: ReturnType<typeof DeviceStoreFactory.getStore>;

  beforeEach(async () => {
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = undefined;
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    store = DeviceStoreFactory.getStore();
    process.env.NODE_ENV = env;
    expect(store.constructor.name).to.equal('LokiDeviceStore');
    await store.addDevices([
      { udid: 'clear-hub-phone', host: HUB, platform: 'android' } as any,
      { udid: 'clear-node-phone', host: NODE, platform: 'android' } as any,
    ]);
  });

  afterEach(async () => {
    await store.removeDevices({ udid: 'clear-hub-phone' });
    await store.removeDevices({ udid: 'clear-node-phone' });
    (DeviceStoreFactory as any)._deviceStore = savedStore;
  });

  it('deletes only the phones filed under the given hosts', async () => {
    await store.clearStorage([HUB]);
    expect(await store.findDevice({ udid: 'clear-hub-phone' })).to.equal(null);
    expect(await store.findDevice({ udid: 'clear-node-phone' })).to.include({ host: NODE });
  });
});
