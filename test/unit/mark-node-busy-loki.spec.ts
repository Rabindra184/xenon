import 'reflect-metadata';
import { expect } from 'chai';
import { XenonDatabase } from '../../src/data-service/db';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { useLokiStores } from '../helpers/loki-stores';

/**
 * markNodeBusy on the in-memory store: the hub's note that a node has just
 * taken its phone for a preview. The Prisma store is covered with the hub's
 * allocation in hub-node-race.spec.ts.
 */
describe('markNodeBusy (in-memory store)', () => {
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

  it('does nothing for a phone it doesn’t have', async () => {
    await DeviceStoreFactory.getStore().markNodeBusy('mark-node-busy-s9', NODE);
    expect((await XenonDatabase.DeviceModel).find({ udid: 'mark-node-busy-s9' })).to.deep.equal([]);
  });
});
