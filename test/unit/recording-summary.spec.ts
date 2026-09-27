import { expect } from 'chai';
import {
  buildLibrary,
  cursorOf,
  groupStatus,
  summarizeGroup,
  type SummaryContext,
  type SummaryRow,
} from '../../src/services/recording/recordingSummary';

const T0 = Date.parse('2026-09-20T10:00:00.000Z');
const DAY = 86_400_000;

function row(over: Partial<SummaryRow> = {}): SummaryRow {
  return {
    id: 'r1',
    group_id: 'g1',
    device_udid: 'U1',
    status: 'STOPPED',
    started_at: new Date(T0 - 1000),
    ended_at: new Date(T0 + 60_000),
    duration_ms: 61_000,
    size_bytes: 1000,
    fail_reason: null,
    started_by: 'usr_alice',
    timing: { version: 1, spawnedAtMs: T0 - 1000, groupT0Ms: T0 },
    bookmarkLabels: [],
    annotationCount: 0,
    ...over,
  };
}

const ctx: SummaryContext = {
  devices: new Map([
    ['U1', { name: 'Galaxy S9+', platform: 'android' }],
    ['U2', { name: 'iPhone 17', platform: 'ios' }],
  ]),
  users: new Map([['usr_alice', 'Alice']]),
  retention: { days: 30, failedDays: 2, maxCount: 100 },
  hasComposite: (g) => g === 'g1',
};

describe('recording summaries', () => {
  it('reads a groups status from its rows', () => {
    expect(groupStatus([{ status: 'STOPPED' }, { status: 'RECORDING' }])).to.equal('recording');
    expect(groupStatus([{ status: 'FAILED' }, { status: 'DISCARDED' }])).to.equal('failed');
    expect(groupStatus([{ status: 'FAILED' }, { status: 'STOPPED' }])).to.equal('done');
  });

  it('puts each phone on the groups timeline from its timing file', () => {
    const s = summarizeGroup(
      [
        row(),
        row({
          id: 'r2',
          device_udid: 'U2',
          started_at: new Date(T0 + 41_000),
          duration_ms: 20_000,
          timing: { version: 1, spawnedAtMs: T0 + 42_000, groupT0Ms: T0 },
        }),
      ],
      ctx,
    );
    expect(s.startedAt).to.equal(new Date(T0).toISOString());
    expect(s.phones.map((p) => [p.name, p.offsetMs])).to.deep.equal([
      ['Galaxy S9+', -1000],
      ['iPhone 17', 42_000],
    ]);
    // The timeline runs from the earliest frame (-1000) to the latest end:
    // max(-1000 + 61000, 42000 + 20000) - (-1000)
    expect(s.durationMs).to.equal(63_000);
  });

  it('fits the whole of a phone that started well before t=0 into the length', () => {
    // A two-phone start where the iPhone took 13.7 s to connect: the S9+ was
    // already recording, so its video starts 13.7 s before the group's t=0.
    const s = summarizeGroup(
      [
        row({
          duration_ms: 30_000,
          timing: { version: 1, spawnedAtMs: T0 - 13_700, groupT0Ms: T0 },
        }),
        row({
          id: 'r2',
          device_udid: 'U2',
          duration_ms: 16_000,
          timing: { version: 1, spawnedAtMs: T0 - 756, groupT0Ms: T0 },
        }),
      ],
      ctx,
    );
    // Offsets stay on the group's t=0, which marks and bookmarks count from.
    expect(s.phones.map((p) => p.offsetMs)).to.deep.equal([-13_700, -756]);
    expect(s.durationMs).to.equal(30_000);
    const origin = Math.min(0, ...s.phones.map((p) => p.offsetMs));
    s.phones.forEach((p) =>
      expect(p.offsetMs - origin + (p.durationMs as number)).to.be.at.most(s.durationMs as number),
    );
  });

  it('falls back to started_at when a recording has no timing file', () => {
    const s = summarizeGroup(
      [
        row({ timing: undefined, started_at: new Date(T0) }),
        row({ id: 'r2', device_udid: 'U2', timing: undefined, started_at: new Date(T0 + 5000) }),
      ],
      ctx,
    );
    expect(s.startedAt).to.equal(new Date(T0).toISOString());
    expect(s.phones.map((p) => p.offsetMs)).to.deep.equal([0, 5000]);
  });

  it('ignores a timing file that puts the video impossibly early', () => {
    const s = summarizeGroup(
      [
        row({
          timing: { version: 1, spawnedAtMs: T0 - 10 * 60_000, groupT0Ms: T0 },
          started_at: new Date(T0),
        }),
      ],
      ctx,
    );
    expect(s.phones[0].offsetMs).to.equal(0);
  });

  it('names phones and people, falling back to the UDID and Unknown user', () => {
    const s = summarizeGroup([row({ device_udid: 'GONE-1', started_by: 'usr_deleted' })], ctx);
    expect(s.phones[0].name).to.equal('GONE-1');
    expect(s.phones[0].platform).to.equal(null);
    expect(s.startedBy).to.deep.equal({ id: 'usr_deleted', name: 'Unknown user' });
    expect(summarizeGroup([row({ started_by: null })], ctx).startedBy).to.equal(null);
  });

  it('has no end or length while recording', () => {
    const s = summarizeGroup(
      [row({ status: 'RECORDING', ended_at: null, duration_ms: null })],
      ctx,
    );
    expect(s.status).to.equal('recording');
    expect(s.endedAt).to.equal(null);
    expect(s.durationMs).to.equal(null);
  });

  it('keeps a done group for days and a failed one for failedDays, from its first start', () => {
    const done = summarizeGroup([row()], ctx);
    expect(done.keptUntil).to.equal(new Date(T0 - 1000 + 30 * DAY).toISOString());
    const failed = summarizeGroup([row({ status: 'FAILED', fail_reason: 'no frames' })], ctx);
    expect(failed.keptUntil).to.equal(new Date(T0 - 1000 + 2 * DAY).toISOString());
    expect(failed.phones[0].failReason).to.equal('no frames');
  });

  it('adds up bookmarks, marks and bytes, and says whether there is a composite', () => {
    const s = summarizeGroup(
      [
        row({ bookmarkLabels: ['login'], annotationCount: 2, size_bytes: 1000 }),
        row({
          id: 'r2',
          device_udid: 'U2',
          bookmarkLabels: ['pay', 'done'],
          annotationCount: 1,
          size_bytes: null,
        }),
      ],
      ctx,
    );
    expect([s.bookmarkCount, s.annotationCount, s.sizeBytes, s.hasComposite]).to.deep.equal([
      3,
      3,
      1000,
      true,
    ]);
    expect(s.phones.map((p) => p.annotationCount)).to.deep.equal([2, 1]);
  });
});

describe('the library', () => {
  // Three groups, a day apart: g3 newest.
  const rows = [
    row({ group_id: 'g1', id: 'a', started_at: new Date(T0), timing: undefined }),
    row({
      group_id: 'g2',
      id: 'b',
      device_udid: 'U2',
      started_at: new Date(T0 + DAY),
      timing: undefined,
      started_by: null,
      bookmarkLabels: ['Checkout button'],
    }),
    row({ group_id: 'g3', id: 'c', started_at: new Date(T0 + 2 * DAY), timing: undefined }),
  ];
  const now = T0 + 2 * DAY + 1000;
  const all = (filter = {}, limit = 50, cursor?: string) =>
    buildLibrary(rows, ctx, filter, { limit, cursor, now });

  it('lists groups newest first', () => {
    expect(all().recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g2', 'g1']);
    expect(all().total).to.equal(3);
  });

  it('filters by phone, by who recorded (or unknown), by time, and by text', () => {
    expect(all({ udid: 'U2' }).recordings.map((s) => s.groupId)).to.deep.equal(['g2']);
    expect(all({ startedBy: 'usr_alice' }).recordings.map((s) => s.groupId)).to.deep.equal([
      'g3',
      'g1',
    ]);
    expect(all({ startedBy: 'unknown' }).recordings.map((s) => s.groupId)).to.deep.equal(['g2']);
    expect(all({ since: T0 + DAY }).recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g2']);
    expect(all({ q: 'checkout' }).recordings.map((s) => s.groupId)).to.deep.equal(['g2']);
    expect(all({ q: 'IPHONE' }).recordings.map((s) => s.groupId)).to.deep.equal(['g2']);
    expect(all({ q: 'u1' }).recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g1']);
    expect(all({ udid: 'U2' }).total).to.equal(1);
  });

  it('pages with a cursor, and ends with a null cursor', () => {
    const first = all({}, 2);
    expect(first.recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g2']);
    expect(first.nextCursor).to.equal(cursorOf(first.recordings[1]));
    const second = all({}, 2, first.nextCursor as string);
    expect(second.recordings.map((s) => s.groupId)).to.deep.equal(['g1']);
    expect(second.nextCursor).to.equal(null);
    expect(second.total).to.equal(3);
  });

  it('continues after a cursor whose group was deleted meanwhile', () => {
    const gone = `${T0 + DAY}_g2`;
    const out = buildLibrary(
      rows.filter((r) => r.group_id !== 'g2'),
      ctx,
      {},
      { limit: 50, cursor: gone, now },
    );
    expect(out.recordings.map((s) => s.groupId)).to.deep.equal(['g1']);
  });

  it('counts the menus options across every recording, whatever is filtered', () => {
    const f = all({ udid: 'U2' }).facets;
    expect(f.phones).to.deep.equal([
      { udid: 'U1', name: 'Galaxy S9+', count: 2 },
      { udid: 'U2', name: 'iPhone 17', count: 1 },
    ]);
    expect(f.people).to.deep.equal([{ id: 'usr_alice', name: 'Alice', count: 2 }]);
    expect(f.unknownCount).to.equal(1);
    expect(f.when).to.deep.equal({ any: 3, '24h': 1, '7d': 3, '30d': 3 });
  });
});
