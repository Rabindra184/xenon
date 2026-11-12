import 'reflect-metadata';
import { expect } from 'chai';
import { BusyPrecheck } from '../../src/services/recording/busy-precheck';

// Observer-mode recording (ENH-06): a recording may name the session it
// watches. The phone running that very session is let through; anything else
// on the phone (another session, another recording, another user's lease) is
// refused as before.

const HOST = 'http://hub:4723';
const ALICE = 'usr_alice';
const BOB_KEY = 'key_bob';

describe('BusyPrecheck with an observed session', () => {
  const precheck = (
    rows: Record<string, any>,
    opts: { recording?: string[]; lease?: { actorId: string } | null } = {},
  ) =>
    new BusyPrecheck(
      {
        findDevice: async ({ udid }: any) =>
          rows[udid] ? { udid, host: HOST, ...rows[udid] } : null,
      },
      { isRecording: async (udid: string) => (opts.recording ?? []).includes(udid) },
      {
        find: async () => opts.lease ?? null,
        holderOf: async (actorId: string) => (actorId === BOB_KEY ? 'usr_bob' : null),
      },
    );

  const observing = (udid: string, sessionId: string) => new Map([[udid, sessionId]]);

  it("skips automation when the phone's claim names the observed session", async () => {
    const pc = precheck({ U1: { busy: true, claimSessionId: 'S1', session_id: 'S1' } });
    expect(await pc.findBusy(['U1'], ALICE, undefined, observing('U1', 'S1'))).to.deep.equal([]);
  });

  it('skips it for a node phone claimed by claimSessionId with session_id null', async () => {
    const pc = precheck({ U1: { busy: true, claimSessionId: 'S1', session_id: null } });
    expect(await pc.findBusy(['U1'], ALICE, undefined, observing('U1', 'S1'))).to.deep.equal([]);
  });

  it('still refuses automation for another session on the phone', async () => {
    const pc = precheck({ U1: { busy: true, claimSessionId: 'S1', session_id: 'S1' } });
    const out = await pc.findBusy(['U1'], ALICE, undefined, observing('U1', 'S2'));
    expect(out).to.deep.equal([{ udid: 'U1', reason: 'automation', sessionId: 'S1' }]);
  });

  it('still refuses a phone with another recording', async () => {
    const pc = precheck(
      { U1: { busy: true, claimSessionId: 'S1', session_id: 'S1' } },
      { recording: ['U1'] },
    );
    const out = await pc.findBusy(['U1'], ALICE, undefined, observing('U1', 'S1'));
    expect(out).to.deep.equal([{ udid: 'U1', reason: 'recording_other_group' }]);
  });

  it("still refuses another user's lease", async () => {
    const pc = precheck(
      { U1: { busy: true, claimSessionId: 'S1', session_id: 'S1' } },
      { lease: { actorId: BOB_KEY } },
    );
    const out = await pc.findBusy(['U1'], ALICE, undefined, observing('U1', 'S1'));
    expect(out).to.deep.equal([{ udid: 'U1', reason: 'leased' }]);
  });

  it("without observed, a session's phone is refused as before", async () => {
    const pc = precheck({ U1: { busy: true, claimSessionId: 'S1', session_id: 'S1' } });
    const out = await pc.findBusy(['U1'], ALICE);
    expect(out).to.deep.equal([{ udid: 'U1', reason: 'automation', sessionId: 'S1' }]);
  });
});
