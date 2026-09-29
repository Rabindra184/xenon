import 'reflect-metadata';
import { expect } from 'chai';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { prisma } from '../../src/prisma';
import { IDevice } from '../../src/interfaces/IDevice';

/**
 * PrismaDeviceStore.addDevices, run as real queries.
 *
 * test/unit/device-sync-lost-update.spec.ts runs the store against an
 * in-memory table; this proves the same rules hold on the real upsert: a known
 * phone gets only its discovery columns (so a sync can't free a phone in a
 * session), only new phones are returned, and `mirror` writes every column.
 */
describe('PrismaDeviceStore.addDevices (integration)', function () {
  this.timeout(60_000);

  const store = new PrismaDeviceStore();
  const stamp = Date.now();
  const HOST = `http://add-devices-${stamp}:4723`;
  const KNOWN = `ad-known-${stamp}`;
  const NEW = `ad-new-${stamp}`;
  const UDIDS = [KNOWN, NEW];

  const phone = (udid: string, over: Partial<IDevice> = {}) =>
    ({
      udid,
      host: HOST,
      name: 'Galaxy S9+',
      platform: 'android',
      deviceType: 'real',
      realDevice: true,
      state: 'device',
      sdk: '10',
      busy: false,
      userBlocked: false,
      offline: false,
      ...over,
    }) as IDevice;

  const row = (udid: string) => prisma.device.findFirst({ where: { udid, host: HOST } });

  beforeEach(async () => {
    await prisma.device.deleteMany({ where: { udid: { in: UDIDS } } });
    await prisma.device.create({
      data: {
        udid: KNOWN,
        host: HOST,
        name: 'Galaxy S9+',
        platform: 'android',
        sdk: '10',
        busy: true,
        session_id: 'sess-1',
        sessionStartTime: 42,
      },
    });
  });

  after(async () => {
    await prisma.device.deleteMany({ where: { udid: { in: UDIDS } } });
  });

  it('refreshes a known phone’s discovery columns but leaves its session alone', async () => {
    const added = await store.addDevices([phone(KNOWN, { sdk: '11', sessionStartTime: 0 })]);

    expect(added).to.deep.equal([]);
    expect(await row(KNOWN)).to.include({
      sdk: '11',
      busy: true,
      session_id: 'sess-1',
      sessionStartTime: 42,
    });
  });

  it('adds and returns only the phone that is new', async () => {
    const added = await store.addDevices([phone(KNOWN), phone(NEW, { name: 'Pixel 8' })]);

    expect(added.map((d) => d.udid)).to.deep.equal([NEW]);
    expect(await row(NEW)).to.include({ name: 'Pixel 8', busy: false });
    expect(await row(KNOWN)).to.include({ busy: true });
  });

  it("as a node's report, records the node's busy apart and never writes the session", async () => {
    await prisma.device.updateMany({
      where: { udid: KNOWN, host: HOST },
      data: { claimSessionId: 'sess-1', claimedAt: 41 },
    });

    await store.addDevices([phone(KNOWN, { busy: false, session_id: 'node-sess', sdk: '11' })], {
      nodeReport: true,
    });

    expect(await row(KNOWN)).to.include({
      sdk: '11',
      nodeBusy: false,
      busy: true,
      session_id: 'sess-1',
      claimSessionId: 'sess-1',
    });
  });
});
