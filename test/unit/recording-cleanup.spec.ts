import { expect } from 'chai';
import path from 'path';
import {
  selectExpiredRecordings,
  selectOrphanDirectories,
  isRecordingSweepSafe,
} from '../../src/services/recording/recordingCleanup';

// Issue #209. Live Devices recordings were never removed — no retention policy
// covered them, there is no DELETE route, and roughly half the directories on
// disk had no DB row at all (265MB of 313MB on the machine in the report).
//
// The decision logic lives here, pure, because the destructive half of a
// cleanup job is exactly what you cannot safely discover in production.

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const ago = (days: number) => new Date(NOW - days * DAY);

function row(over: Partial<any> = {}): any {
  return { id: 'r1', status: 'STOPPED', started_at: ago(1), ...over };
}

describe('selectExpiredRecordings', () => {
  const base = { now: NOW, days: 30, maxCount: 100, failedDays: 2 };

  it('NEVER expires an in-flight recording, however old', () => {
    // The one rule that must not have exceptions: deleting a row (and file)
    // out from under a running ffmpeg would corrupt an active capture.
    const rows = [row({ id: 'live', status: 'RECORDING', started_at: ago(400) })];
    expect(selectExpiredRecordings({ ...base, rows })).to.deep.equal([]);
  });

  it('expires a finished recording past the age window', () => {
    const rows = [row({ id: 'old', started_at: ago(31) }), row({ id: 'new', started_at: ago(29) })];
    expect(selectExpiredRecordings({ ...base, rows })).to.deep.equal(['old']);
  });

  it('expires failed recordings on their own, much shorter window', () => {
    // A FAILED row has no playable file — it is noise, not footage.
    const rows = [
      row({ id: 'failed-old', status: 'FAILED', started_at: ago(3) }),
      row({ id: 'failed-new', status: 'FAILED', started_at: ago(1) }),
      row({ id: 'stopped-same-age', status: 'STOPPED', started_at: ago(3) }),
    ];
    expect(selectExpiredRecordings({ ...base, rows })).to.deep.equal(['failed-old']);
  });

  it('enforces the count cap oldest-first, like builds', () => {
    const rows = [
      row({ id: 'a', started_at: ago(4) }),
      row({ id: 'b', started_at: ago(3) }),
      row({ id: 'c', started_at: ago(2) }),
      row({ id: 'd', started_at: ago(1) }),
    ];
    expect(selectExpiredRecordings({ ...base, rows, maxCount: 2 }).sort()).to.deep.equal([
      'a',
      'b',
    ]);
  });

  it('does not let in-flight recordings consume the count cap', () => {
    // Otherwise starting a big group recording would evict finished ones.
    const rows = [
      row({ id: 'live1', status: 'RECORDING', started_at: ago(0) }),
      row({ id: 'live2', status: 'RECORDING', started_at: ago(0) }),
      row({ id: 'keep', started_at: ago(1) }),
    ];
    expect(selectExpiredRecordings({ ...base, rows, maxCount: 2 })).to.deep.equal([]);
  });

  it('combines both rules without double-counting', () => {
    const rows = [
      row({ id: 'ancient', started_at: ago(90) }),
      row({ id: 'x', started_at: ago(3) }),
      row({ id: 'y', started_at: ago(2) }),
      row({ id: 'z', started_at: ago(1) }),
    ];
    const out = selectExpiredRecordings({ ...base, rows, maxCount: 2 });
    expect(out.sort()).to.deep.equal(['ancient', 'x']);
    expect(new Set(out).size, 'no id may appear twice').to.equal(out.length);
  });

  it('treats a missing started_at as un-expirable rather than ancient', () => {
    // A null date must not read as epoch 0 and delete the row instantly.
    const rows = [row({ id: 'nodate', started_at: null })];
    expect(selectExpiredRecordings({ ...base, rows })).to.deep.equal([]);
  });
});

describe('selectOrphanDirectories', () => {
  const R = '/assets/recordings';
  const dir = (n: string) => path.join(R, n);
  const grpDir = (n: string) => path.join(R, '_groups', n);

  it('keeps a directory a live row points into', () => {
    const out = selectOrphanDirectories({
      deviceDirs: [dir('aaa')],
      groupDirs: [],
      livePaths: [path.join(dir('aaa'), 'video', 'aaa.mp4')],
      liveGroupIds: [],
    });
    expect(out).to.deep.equal([]);
  });

  it('does NOT assume the directory is named after the recording id', () => {
    // The trap that would have destroyed 4 live recordings on the reporter's
    // machine: only 35 of 39 rows were id-named. Directory `4c9babeb…` belonged
    // to row `c5930c7b…`. Reachability is the file_path, never the name.
    const out = selectOrphanDirectories({
      deviceDirs: [dir('4c9babeb')],
      groupDirs: [],
      livePaths: [path.join(dir('4c9babeb'), 'video', 'anything.mp4')],
      liveGroupIds: [],
    });
    expect(out, 'a live file inside it makes it reachable regardless of name').to.deep.equal([]);
  });

  it('flags a directory nothing points into', () => {
    const out = selectOrphanDirectories({
      deviceDirs: [dir('ghost')],
      groupDirs: [],
      livePaths: [path.join(dir('real'), 'video', 'real.mp4')],
      liveGroupIds: [],
    });
    expect(out).to.deep.equal([dir('ghost')]);
  });

  it('does not confuse a sibling whose name shares a prefix', () => {
    // /assets/recordings/ab must not count as containing /assets/recordings/abc/...
    const out = selectOrphanDirectories({
      deviceDirs: [dir('ab')],
      groupDirs: [],
      livePaths: [path.join(dir('abc'), 'video', 'v.mp4')],
      liveGroupIds: [],
    });
    expect(out, 'prefix match must be on a path boundary').to.deep.equal([dir('ab')]);
  });

  it('keeps a group directory whose id still has recordings', () => {
    const out = selectOrphanDirectories({
      deviceDirs: [],
      groupDirs: [grpDir('g1'), grpDir('g2')],
      livePaths: [],
      liveGroupIds: ['g1'],
    });
    expect(out).to.deep.equal([grpDir('g2')]);
  });
});

describe('isRecordingSweepSafe', () => {
  it('refuses to sweep when the row query came back empty but files exist', () => {
    // The failure mode that turns a cleanup job into data loss: a failed or
    // mis-scoped DB read makes every directory look unreachable.
    expect(isRecordingSweepSafe({ rowCount: 0, dirCount: 42 })).to.equal(false);
  });

  it('allows an empty sweep on a genuinely empty install', () => {
    expect(isRecordingSweepSafe({ rowCount: 0, dirCount: 0 })).to.equal(true);
  });

  it('allows a normal sweep', () => {
    expect(isRecordingSweepSafe({ rowCount: 39, dirCount: 78 })).to.equal(true);
  });
});
