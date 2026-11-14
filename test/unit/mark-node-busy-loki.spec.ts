import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { XenonDatabase } from '../../src/data-service/db';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { useLokiStores } from '../helpers/loki-stores';
import { useScratchDatabase } from '../helpers/scratch-database';
import { forgetAllNodeBusyNotes, forgetNodeBusy } from '../../src/data-service/nodeBusyNotes';

/**
 * markNodeBusy on the in-memory store: the hub's note that a node has just
 * taken its phone for a preview. The Prisma store is covered with the hub's
 * allocation in hub-node-race.spec.ts.
 */
describe('markNodeBusy (in-memory store)', () => {
  // A report of "free" asks the lease table (activeLeaseOn), which is Prisma's.
  useScratchDatabase();
  useLokiStores();

  const NODE = 'http://10.0.0.9:4725';
  const phone = (host: string) => ({
    udid: 'mark-node-busy-s9',
    host,
    platform: 'android',
    busy: false,
    nodeBusy: false,
    offline: false,
    userBlocked: false,
  });

  afterEach(async () => {
    (await XenonDatabase.DeviceModel).findAndRemove({ udid: 'mark-node-busy-s9' });
    forgetAllNodeBusyNotes();
  });

  it('sets nodeBusy and busy on that phone of that node only', async () => {
    const model = await XenonDatabase.DeviceModel;
    model.insert(phone(NODE));
    model.insert(phone('http://10.0.0.8:4725'));

    await DeviceStoreFactory.getStore().markNodeBusy('mark-node-busy-s9', NODE, 'manual_u1_s9');

    const rows = model.find({ udid: 'mark-node-busy-s9' });
    const byHost = Object.fromEntries(
      rows.map((r: any) => [r.host, [r.busy, r.nodeBusy, r.nodeHold ?? null]]),
    );
    expect(byHost).to.deep.equal({
      [NODE]: [true, true, 'manual_u1_s9'],
      'http://10.0.0.8:4725': [false, false, null],
    });
  });

  it('takes the holder from a node’s report: a preview hold, not a session', async () => {
    const model = await XenonDatabase.DeviceModel;
    model.insert(phone(NODE));
    const store = DeviceStoreFactory.getStore();
    const reported = (session_id: string | null, busy: boolean) =>
      store.addDevices([{ ...phone(NODE), busy, session_id } as any], { nodeReport: true });
    const hold = () => (model.findOne({ udid: 'mark-node-busy-s9', host: NODE }) as any).nodeHold;

    await reported('manual_u1_mark-node-busy-s9', true);
    expect(hold()).to.equal('manual_u1_mark-node-busy-s9');
    await reported('appium-9', true);
    expect(hold()).to.equal(null);
    await reported(null, false);
    expect(hold()).to.equal(null);
  });

  it('a report of "free" the node sent before the preview can’t undo it', async () => {
    const model = await XenonDatabase.DeviceModel;
    model.insert(phone(NODE));
    const store = DeviceStoreFactory.getStore();
    const row = () => model.findOne({ udid: 'mark-node-busy-s9', host: NODE }) as any;

    await store.markNodeBusy('mark-node-busy-s9', NODE, 'manual_u1_s9');
    await store.addDevices([{ ...phone(NODE), busy: false, sdk: '11' } as any], {
      nodeReport: true,
    });
    expect([row().busy, row().nodeBusy, row().nodeHold, row().sdk]).to.deep.equal([
      true,
      true,
      'manual_u1_s9',
      '11',
    ]);

    // Once the node has let it go (a stopped preview), it is believed.
    forgetNodeBusy('mark-node-busy-s9', NODE);
    await store.addDevices([{ ...phone(NODE), busy: false } as any], { nodeReport: true });
    expect([row().busy, row().nodeBusy, row().nodeHold]).to.deep.equal([false, false, null]);
  });

  it('a late report of "free" can’t undo it until the node has said busy', async () => {
    const model = await XenonDatabase.DeviceModel;
    model.insert(phone(NODE));
    const store = DeviceStoreFactory.getStore();
    const row = () => model.findOne({ udid: 'mark-node-busy-s9', host: NODE }) as any;
    const reported = (busy: boolean) =>
      store.addDevices([{ ...phone(NODE), busy } as any], { nodeReport: true });
    const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
    const clock = sinon.useFakeTimers({ now: T0, toFake: ['Date'] });
    try {
      await store.markNodeBusy('mark-node-busy-s9', NODE, 'manual_u1_s9');
      // Held up past two report intervals, the note's first window (#624).
      clock.setSystemTime(T0 + 2 * 30_000 + 1);
      await reported(false);
      expect([row().busy, row().nodeBusy]).to.deep.equal([true, true]);

      // The node says busy: it has caught up, and its next "free" is believed.
      await reported(true);
      await reported(false);
      expect([row().busy, row().nodeBusy]).to.deep.equal([false, false]);
    } finally {
      clock.restore();
    }
  });

  it('does nothing for a phone it doesn’t have', async () => {
    await DeviceStoreFactory.getStore().markNodeBusy('mark-node-busy-s9', NODE);
    expect((await XenonDatabase.DeviceModel).find({ udid: 'mark-node-busy-s9' })).to.deep.equal([]);
  });
});
