import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { BusyPrecheck } from '../../src/services/recording/busy-precheck';

describe('BusyPrecheck', () => {
  afterEach(() => sinon.restore());

  function withDevices(rows: Record<string, any>) {
    return {
      findDevice: async ({ udid }: any) => rows[udid] ?? null,
    };
  }

  it('returns empty list when all UDIDs are free', async () => {
    const pc = new BusyPrecheck(
      withDevices({
        U1: { udid: 'U1', busy: false },
        U2: { udid: 'U2', busy: false },
      }),
    );
    expect(await pc.findBusy(['U1', 'U2'])).to.deep.equal([]);
  });

  it('flags automation-busy devices with sessionId', async () => {
    const pc = new BusyPrecheck(
      withDevices({
        U1: { udid: 'U1', busy: true, session_id: 'sess-abc' },
      }),
    );
    const out = await pc.findBusy(['U1']);
    expect(out).to.have.length(1);
    expect(out[0]).to.deep.include({ udid: 'U1', reason: 'automation', sessionId: 'sess-abc' });
  });

  it('flags manual-busy devices as manual_other regardless of caller', async () => {
    const pc = new BusyPrecheck(
      withDevices({
        U1: { udid: 'U1', busy: true, session_id: 'manual_U1' },
      }),
    );
    const out = await pc.findBusy(['U1']);
    expect(out[0]).to.deep.include({ udid: 'U1', reason: 'manual_other', blockId: 'manual_U1' });
  });

  it('returns reason=unknown for missing devices', async () => {
    const pc = new BusyPrecheck(withDevices({}));
    const out = await pc.findBusy(['MISSING']);
    expect(out[0]).to.deep.include({ udid: 'MISSING', reason: 'unknown' });
  });

  it('partial busy: only the busy UDID is in the list', async () => {
    const pc = new BusyPrecheck(
      withDevices({
        U1: { udid: 'U1', busy: false },
        U2: { udid: 'U2', busy: true, session_id: 'sess-x' },
        U3: { udid: 'U3', busy: false },
      }),
    );
    const out = await pc.findBusy(['U1', 'U2', 'U3']);
    expect(out).to.have.length(1);
    expect(out[0].udid).to.equal('U2');
  });
});
