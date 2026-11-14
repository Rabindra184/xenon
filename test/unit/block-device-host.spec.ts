import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { blockDevice } from '../../src/data-service/device-service';
import { SocketServer } from '../../src/services/SocketServer';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * blockDevice with a manual hold writes it only where no session holds the
 * phone (a preview must not overwrite a live Appium session's id), in one
 * conditional write on the phone's row (takeManualHold). A udid two servers
 * report (emulator-5554 on a hub and on its node) is two phones, so that
 * write names the phone it blocks, by udid and host, never by udid alone.
 */

const UDID = 'emulator-5554';
const H1 = 'http://h1:4723';
const H2 = 'http://h2:4723';
const HOLD = `manual_usr_me_${UDID}`;

describe('blockDevice writes the hold of the phone it blocks, by udid and host', () => {
  let savedStore: unknown;
  let restore: () => void;
  let rows: Array<{ udid: string; host: string; busy: boolean; session_id: string | null }>;
  let takeManualHold: sinon.SinonSpy;

  beforeEach(() => {
    restore = saveRegistrations(SocketServer);
    Container.set({
      id: SocketServer,
      value: { emitToDashboardForDevices: async () => undefined },
    });
    const matches = (filter: any) => (row: any) =>
      Object.keys(filter).every((k) => row[k] === filter[k]);
    // The store's rule (isHoldable): no session id but a manual hold.
    takeManualHold = sinon.spy(async (udid: string, host: string, hold: string) => {
      const row = rows.find(matches({ udid, host }));
      if (!row || (row.session_id && !row.session_id.startsWith('manual_'))) return false;
      Object.assign(row, { busy: true, session_id: hold });
      return true;
    });
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = {
      findDevice: async (filter: any) => rows.find(matches(filter)) ?? null,
      findDevices: async (filter: any) => rows.filter(matches(filter)),
      getDevices: async (filter: any) => rows.filter(matches(filter)),
      takeManualHold,
    };
  });

  afterEach(() => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restore();
  });

  it("blocks the h1 phone, whatever the h2 row's other user's hold", async () => {
    rows = [
      { udid: UDID, host: H2, busy: true, session_id: `manual_usr_other_${UDID}` },
      { udid: UDID, host: H1, busy: false, session_id: null },
    ];

    expect(await blockDevice(UDID, H1, HOLD)).to.equal(true);

    expect(takeManualHold.calledOnceWithExactly(UDID, H1, HOLD)).to.equal(true);
    expect(rows[1]).to.include({ busy: true, session_id: HOLD });
    expect(rows[0].session_id).to.equal(`manual_usr_other_${UDID}`);
  });

  it("keeps the h1 phone's own Appium session, not one the h2 phone runs", async () => {
    rows = [
      { udid: UDID, host: H2, busy: true, session_id: 'appium-session-h2' },
      { udid: UDID, host: H1, busy: false, session_id: null },
    ];

    expect(await blockDevice(UDID, H1, HOLD)).to.equal(true);

    expect(rows[1].session_id, 'the h1 phone has no session to keep').to.equal(HOLD);
    expect(rows[0].session_id).to.equal('appium-session-h2');
  });
});
