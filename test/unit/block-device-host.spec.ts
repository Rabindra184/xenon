import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { blockDevice } from '../../src/data-service/device-service';
import { SocketServer } from '../../src/services/SocketServer';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * blockDevice with a manual hold reads the phone's existing hold first (a
 * preview must not overwrite a live Appium session's id). A udid two servers
 * report (emulator-5554 on a hub and on its node) is two phones, so it reads
 * the row of the phone it blocks, by udid and host, never by udid alone.
 */

const UDID = 'emulator-5554';
const H1 = 'http://h1:4723';
const H2 = 'http://h2:4723';
const HOLD = `manual_usr_me_${UDID}`;

describe('blockDevice reads the hold of the phone it blocks, by udid and host', () => {
  let savedStore: unknown;
  let restore: () => void;
  let rows: Array<{ udid: string; host: string; busy: boolean; session_id: string | null }>;
  let findDevice: sinon.SinonSpy;
  let updateDevice: sinon.SinonSpy;

  beforeEach(() => {
    restore = saveRegistrations(SocketServer);
    Container.set({
      id: SocketServer,
      value: { emitToDashboardForDevices: async () => undefined },
    });
    const matches = (filter: any) => (row: any) =>
      Object.keys(filter).every((k) => row[k] === filter[k]);
    findDevice = sinon.spy(async (filter: any) => rows.find(matches(filter)) ?? null);
    updateDevice = sinon.spy(async () => undefined);
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = {
      findDevice,
      findDevices: async (filter: any) => rows.filter(matches(filter)),
      getDevices: async (filter: any) => rows.filter(matches(filter)),
      updateDevice,
    };
  });

  afterEach(() => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restore();
  });

  it("reads the h1 row, not the h2 row's other user's hold, and blocks the h1 phone", async () => {
    rows = [
      { udid: UDID, host: H2, busy: true, session_id: `manual_usr_other_${UDID}` },
      { udid: UDID, host: H1, busy: false, session_id: null },
    ];

    await blockDevice(UDID, H1, HOLD);

    expect(findDevice.calledOnceWithExactly({ udid: UDID, host: H1 })).to.equal(true);
    expect(updateDevice.calledOnce).to.equal(true);
    const [udid, host, data] = updateDevice.firstCall.args as unknown as [string, string, any];
    expect([udid, host]).to.deep.equal([UDID, H1]);
    expect(data).to.include({ busy: true, session_id: HOLD });
  });

  it("keeps the h1 phone's own Appium session, not one the h2 phone runs", async () => {
    rows = [
      { udid: UDID, host: H2, busy: true, session_id: 'appium-session-h2' },
      { udid: UDID, host: H1, busy: false, session_id: null },
    ];

    await blockDevice(UDID, H1, HOLD);

    const data = updateDevice.firstCall.args[2] as any;
    expect(data.session_id, 'the h1 phone has no session to keep').to.equal(HOLD);
  });
});
