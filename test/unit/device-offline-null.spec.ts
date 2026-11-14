import 'reflect-metadata';
import { expect } from 'chai';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { XenonDatabase } from '../../src/data-service/db';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { useScratchDatabase } from '../helpers/scratch-database';
import { useLokiStores } from '../helpers/loki-stores';

/**
 * `Device.offline` is never written true: a phone that goes offline is
 * deleted. A row whose column is NULL (a row written without it) is not
 * offline. Through 2.36 the Prisma lock asked `offline: false`, which NULL
 * never matches, so such a phone could never be allocated, and a filter for
 * phones that aren't offline left it out on either store.
 */
describe('A phone whose offline column is unset', () => {
  const HOST = 'http://10.0.0.9:4725';

  describe('on the Prisma store', () => {
    const scratch = useScratchDatabase();

    beforeEach(async () => {
      await scratch.db.device.deleteMany({});
      await scratch.db.device.create({
        data: { udid: 'off-null', host: HOST, platform: 'android', busy: false, offline: null },
      });
    });

    it('is allocated', async () => {
      const locked = await new PrismaDeviceStore().findAndLockDevice(
        { udid: ['off-null'], busy: false },
        { claim: true },
      );
      expect(locked?.udid).to.equal('off-null');
      const row = await scratch.db.device.findFirst({ where: { udid: 'off-null' } });
      expect(row).to.include({ busy: true });
    });

    it('is listed as not offline', async () => {
      const listed = await new PrismaDeviceStore().getDevices({ offline: false });
      expect(listed.map((d) => d.udid)).to.deep.equal(['off-null']);
      expect(await new PrismaDeviceStore().getDevices({ offline: true })).to.deep.equal([]);
    });

    it('a phone marked offline is still never allocated', async () => {
      await scratch.db.device.updateMany({ where: { udid: 'off-null' }, data: { offline: true } });
      const locked = await new PrismaDeviceStore().findAndLockDevice({ udid: ['off-null'] }, {});
      expect(locked).to.equal(null);
    });
  });

  describe('on the in-memory store', () => {
    useLokiStores();

    afterEach(async () => {
      (await XenonDatabase.DeviceModel).findAndRemove({ udid: 'off-null' });
    });

    it('is listed as not offline', async () => {
      (await XenonDatabase.DeviceModel).insert({
        udid: 'off-null',
        host: HOST,
        platform: 'android',
        busy: false,
        userBlocked: false,
      });
      const listed = await DeviceStoreFactory.getStore().getDevices({ offline: false } as any);
      expect(listed.map((d) => d.udid)).to.deep.equal(['off-null']);
    });
  });
});
