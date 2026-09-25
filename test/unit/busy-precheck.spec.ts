import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { BusyPrecheck } from '../../src/services/recording/busy-precheck';

describe('BusyPrecheck', () => {
  afterEach(() => sinon.restore());

  // The recording check defaults to Prisma; unit tests must never reach it.
  const precheck = (store: any, recording: string[] = []) =>
    new BusyPrecheck(store, async (udid: string) => recording.includes(udid));

  function withDevices(rows: Record<string, any>) {
    return {
      findDevice: async ({ udid }: any) => rows[udid] ?? null,
    };
  }

  it('returns empty list when all UDIDs are free', async () => {
    const pc = precheck(
      withDevices({
        U1: { udid: 'U1', busy: false },
        U2: { udid: 'U2', busy: false },
      }),
    );
    expect(await pc.findBusy(['U1', 'U2'])).to.deep.equal([]);
  });

  it('flags automation-busy devices with sessionId', async () => {
    const pc = precheck(
      withDevices({
        U1: { udid: 'U1', busy: true, session_id: 'sess-abc' },
      }),
    );
    const out = await pc.findBusy(['U1']);
    expect(out).to.have.length(1);
    expect(out[0]).to.deep.include({ udid: 'U1', reason: 'automation', sessionId: 'sess-abc' });
  });

  it('treats a manual lock owned by the calling actor as self, not a blocker', async () => {
    // manual_<actorId>_<udid> is owned by the same dashboard caller, so the
    // recording can take it over.
    const pc = precheck(
      withDevices({
        U1: { udid: 'U1', busy: true, session_id: 'manual_actor-1_U1' },
      }),
    );
    const out = await pc.findBusy(['U1'], 'actor-1');
    expect(out).to.deep.equal([]);
  });

  it('recognises a lock keyed on the caller’s api-key id as self (upgrade tolerance)', async () => {
    // Locks written by versions that keyed on apiKey.id must still resolve to
    // their owner, exactly as isSelfManualLock does for /control. Without the
    // second identity this classifies as manual_other and the caller is
    // refused their own device.
    const pc = precheck(
      withDevices({
        U1: { udid: 'U1', busy: true, session_id: 'manual_key_abc_U1' },
      }),
    );
    expect(await pc.findBusy(['U1'], 'usr_alice', 'key_abc')).to.deep.equal([]);
    // ...and without it, it is still (correctly) foreign.
    expect((await pc.findBusy(['U1'], 'usr_alice'))[0]).to.deep.include({
      udid: 'U1',
      reason: 'manual_other',
    });
  });

  it('does not treat someone else’s api-key lock as self', async () => {
    const pc = precheck(
      withDevices({
        U1: { udid: 'U1', busy: true, session_id: 'manual_key_bob_U1' },
      }),
    );
    const out = await pc.findBusy(['U1'], 'usr_alice', 'key_abc');
    expect(out[0]).to.deep.include({ udid: 'U1', reason: 'manual_other' });
  });

  it('flags a manual lock owned by a different actor as manual_other', async () => {
    const pc = precheck(
      withDevices({
        U1: { udid: 'U1', busy: true, session_id: 'manual_actor-2_U1' },
      }),
    );
    const out = await pc.findBusy(['U1'], 'actor-1');
    expect(out[0]).to.deep.include({
      udid: 'U1',
      reason: 'manual_other',
      blockId: 'manual_actor-2_U1',
    });
  });

  it('treats legacy manual_<udid> (no actor) as foreign — never self', async () => {
    // Locks written by older code carry no actor identity. They must NOT
    // be silently treated as self under the new model.
    const pc = precheck(
      withDevices({
        U1: { udid: 'U1', busy: true, session_id: 'manual_U1' },
      }),
    );
    const out = await pc.findBusy(['U1'], 'actor-1');
    expect(out[0]).to.deep.include({ udid: 'U1', reason: 'manual_other', blockId: 'manual_U1' });
  });

  it('returns reason=unknown for missing devices', async () => {
    const pc = precheck(withDevices({}));
    const out = await pc.findBusy(['MISSING']);
    expect(out[0]).to.deep.include({ udid: 'MISSING', reason: 'unknown' });
  });

  it('partial busy: only the busy UDID is in the list', async () => {
    const pc = precheck(
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

  it('refuses a self-locked device that is already recording (no duplicate capture)', async () => {
    // A reload used to forget the running recording; Record then started a
    // second ffmpeg on the same device because the lock was the caller's own.
    const pc = precheck(
      withDevices({ U1: { udid: 'U1', busy: true, session_id: 'manual_actor-1_U1' } }),
      ['U1'],
    );
    expect(await pc.findBusy(['U1'], 'actor-1')).to.deep.equal([
      { udid: 'U1', reason: 'recording_other_group' },
    ]);
  });

  it('refuses a device with an active recording even if it is not marked busy', async () => {
    const pc = precheck(withDevices({ U1: { udid: 'U1', busy: false } }), ['U1']);
    expect((await pc.findBusy(['U1']))[0]).to.deep.include({
      udid: 'U1',
      reason: 'recording_other_group',
    });
  });
});
