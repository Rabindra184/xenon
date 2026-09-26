import { expect } from 'chai';
import { selectOwnActiveGroups } from '../../src/services/recording/activeRecordings';

const row = (
  id: string,
  group: string,
  udid: string,
  startedIso: string,
  annotations: any[] = [],
) => ({
  id,
  group_id: group,
  device_udid: udid,
  started_at: new Date(startedIso),
  annotations,
});

describe('selectOwnActiveGroups', () => {
  const locks: Record<string, string> = { U1: 'manual_alice_U1', U2: 'manual_bob_U2' };
  const lockOf = (u: string) => locks[u];

  it('returns only groups on devices the caller holds, admins included', () => {
    const out = selectOwnActiveGroups(
      [
        row('r1', 'g1', 'U1', '2026-09-25T10:00:00Z'),
        row('r2', 'g2', 'U2', '2026-09-25T10:00:00Z'),
      ],
      lockOf,
      { userId: 'alice' },
    );
    expect(out.map((g) => g.groupId)).to.deep.equal(['g1']);
  });

  it('reports the earliest start and only still-open marks', () => {
    const out = selectOwnActiveGroups(
      [
        row('r1', 'g1', 'U1', '2026-09-25T10:00:05Z', [
          {
            recording_id: 'r1',
            shape: 'RECT',
            geometry: '{"x":0}',
            color: 'red',
            text: null,
            timecode_ms: 100,
            end_timecode_ms: null,
          },
          {
            recording_id: 'r1',
            shape: 'RECT',
            geometry: '{"x":1}',
            color: 'red',
            text: null,
            timecode_ms: 50,
            end_timecode_ms: 90,
          },
        ]),
      ],
      lockOf,
      { userId: 'alice' },
    );
    expect(out[0].startedAt).to.equal('2026-09-25T10:00:05.000Z');
    expect(out[0].recordings).to.deep.equal([{ id: 'r1', udid: 'U1' }]);
    expect(out[0].annotations).to.deep.equal([
      {
        recordingId: 'r1',
        shape: 'RECT',
        geometry: '{"x":0}',
        color: 'red',
        text: null,
        timecodeMs: 100,
      },
    ]);
  });

  it('uses the earliest row as the group start when devices started apart', () => {
    const out = selectOwnActiveGroups(
      [
        row('r1', 'g1', 'U1', '2026-09-25T10:00:05Z'),
        row('r3', 'g1', 'U3', '2026-09-25T10:00:02Z'),
      ],
      lockOf,
      { userId: 'alice' },
    );
    expect(out[0].startedAt).to.equal('2026-09-25T10:00:02.000Z');
    expect(out[0].recordings).to.have.length(2);
  });

  it('recognises a lock keyed on the caller api-key id (upgrade tolerance)', () => {
    const out = selectOwnActiveGroups(
      [row('r1', 'g1', 'U9', '2026-09-25T10:00:00Z')],
      () => 'manual_key1_U9',
      { userId: 'alice', apiKeyId: 'key1' },
    );
    expect(out).to.have.length(1);
  });

  it('ignores devices with no lock at all', () => {
    expect(
      selectOwnActiveGroups([row('r1', 'g1', 'U5', '2026-09-25T10:00:00Z')], () => null, {
        userId: 'alice',
      }),
    ).to.deep.equal([]);
  });
});
