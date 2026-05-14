import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

/**
 * Verifies that findAndLockDevice skips devices held by an active Lease row.
 *
 * We test the LokiDeviceStore path because:
 *   - It uses the module-level `prisma` export (stubbable via sinon)
 *   - It is the default in NODE_ENV=test per DeviceStoreFactory.getStorageType()
 *
 * We force-use LokiDeviceStore directly (not via factory) so the test is
 * independent of NODE_ENV and any cached factory singleton.
 */
describe('findAndLockDevice excludes active-lease devices', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('skips a device that has an active Lease row, picks the next one', async () => {
    // Stub prisma.lease.findMany to simulate one active lease on u1@h1.
    // The LokiDeviceStore imports `prisma` from '../../src/prisma' at module level;
    // because this is CJS, the dynamic import below hits the same module cache.
    const prismaModule = await import('../../src/prisma');
    const leaseStub = sinon.stub(prismaModule.prisma.lease as any, 'findMany').resolves([
      { deviceUdid: 'u1', deviceHost: 'h1' },
    ]);

    // Import and directly instantiate LokiDeviceStore to avoid the factory
    // singleton which may have been initialised as PrismaDeviceStore in other
    // environments (NODE_ENV != 'test').
    const deviceStoreModule = await import('../../src/data-service/device-store');
    // LokiDeviceStore is not exported — access it through the factory reset trick:
    // force the factory to create a fresh Loki store by clearing the singleton.
    (deviceStoreModule.DeviceStoreFactory as any)._deviceStore = undefined;
    // Temporarily set NODE_ENV so getStorageType() picks 'loki'.
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const store = deviceStoreModule.DeviceStoreFactory.getStore();
    process.env.NODE_ENV = originalEnv;

    // Confirm we got the Loki store.
    expect(store.constructor.name).to.equal('LokiDeviceStore');

    // Stub getDevices to return two candidates: u1 (blocked by lease) and u2 (free).
    sinon.stub(store, 'getDevices' as any).resolves([
      { udid: 'u1', host: 'h1', busy: false, userBlocked: false } as any,
      { udid: 'u2', host: 'h2', busy: false, userBlocked: false } as any,
    ]);
    // Stub updateDevice so no real DB write happens.
    sinon.stub(store, 'updateDevice').resolves();

    const locked = await store.findAndLockDevice({ platform: 'android' } as any);

    expect(locked).to.not.be.null;
    expect(locked!.udid).to.equal('u2');
    expect(leaseStub.calledOnce).to.equal(true);
  });
});
