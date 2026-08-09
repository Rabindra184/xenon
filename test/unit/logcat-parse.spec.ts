import { expect } from 'chai';
import { parseThreadtimeLine } from '../../src/services/logcat/logcatParse';

// `adb logcat -v threadtime` emits:
//   MM-DD HH:MM:SS.mmm   PID   TID L TAG: message
// There is no year, and lines can wrap without a timestamp prefix.

const NOW = new Date('2026-08-09T16:11:00.000Z');

describe('parseThreadtimeLine', () => {
  it('parses a well-formed line into fields', () => {
    const r = parseThreadtimeLine(
      '08-09 16:11:00.005  1408  1408 D KeyguardUpdateMonitor: received broadcast',
      NOW,
    );
    expect(r).to.not.equal(null);
    expect(r!.pid).to.equal(1408);
    expect(r!.tid).to.equal(1408);
    expect(r!.level).to.equal('D');
    expect(r!.tag).to.equal('KeyguardUpdateMonitor');
    expect(r!.message).to.equal('received broadcast');
  });

  it('keeps a message containing colons intact', () => {
    const r = parseThreadtimeLine(
      '08-09 16:11:00.006  1408  1408 D QSClock: status_bar_clock notify: a:b:c',
      NOW,
    );
    expect(r!.tag).to.equal('QSClock');
    expect(r!.message).to.equal('status_bar_clock notify: a:b:c');
  });

  it('handles differing pid and tid', () => {
    const r = parseThreadtimeLine('08-09 16:11:02.651  1408  1813 W NetworkCon: x', NOW);
    expect(r!.pid).to.equal(1408);
    expect(r!.tid).to.equal(1813);
    expect(r!.level).to.equal('W');
  });

  it('accepts every level', () => {
    for (const lvl of ['V', 'D', 'I', 'W', 'E', 'F']) {
      const r = parseThreadtimeLine(`08-09 16:11:00.000  1  1 ${lvl} T: m`, NOW);
      expect(r, lvl).to.not.equal(null);
      expect(r!.level, lvl).to.equal(lvl);
    }
  });

  it('tolerates a tag containing dots and dollars', () => {
    const r = parseThreadtimeLine('08-09 16:11:00.000  1  1 D Tile.WifiTile$1: m', NOW);
    expect(r!.tag).to.equal('Tile.WifiTile$1');
  });

  it('returns null for a continuation line (no timestamp prefix)', () => {
    expect(parseThreadtimeLine('    mTa=0 mLevel=4 more wrapped text', NOW)).to.equal(null);
  });

  it("returns null for logcat's own banner", () => {
    expect(parseThreadtimeLine('--------- beginning of main', NOW)).to.equal(null);
  });

  it('returns null for empty and malformed input', () => {
    expect(parseThreadtimeLine('', NOW)).to.equal(null);
    expect(parseThreadtimeLine('   ', NOW)).to.equal(null);
    expect(parseThreadtimeLine('not a log line at all', NOW)).to.equal(null);
  });

  it('assumes the current year', () => {
    const r = parseThreadtimeLine('08-09 16:11:00.005  1  1 D T: m', NOW);
    expect(new Date(r!.ts).getFullYear()).to.equal(2026);
  });

  // Without this, a log written on 31 Dec and read on 1 Jan lands twelve
  // months in the future.
  //
  // `inferYear` computes in host-local time (`now.getFullYear()`, and
  // `new Date(year, month - 1, day)`), so the clock here must be built from
  // local components rather than a `Z`-suffixed ISO string. A UTC instant of
  // '2026-01-01T00:05:00.000Z' is still 31 December 2025 in any timezone
  // behind UTC, which makes `now.getFullYear()` already 2025 and the
  // rollback branch a no-op that never gets exercised.
  it('rolls back a year when the date would be in the future', () => {
    const jan1 = new Date(2026, 0, 1, 0, 5, 0); // local: 1 Jan 2026 00:05:00
    const r = parseThreadtimeLine('12-31 23:59:00.000  1  1 D T: m', jan1);
    expect(new Date(r!.ts).getFullYear()).to.equal(2025);
  });

  // Pins `> oneDayMs` (not `> 0`) as the rollback threshold.
  //
  // `inferYear` only ever receives `month`/`day` — it never sees the record's
  // time of day, so `candidate` is always *midnight* of that calendar day. If
  // the record shares `now`'s calendar day (as a "few seconds ahead" record
  // naturally would), `candidate - now` is structurally confined to
  // `[-24h, 0]` and can never land inside the `(0, oneDayMs]` window where
  // `> oneDayMs` and `> 0` disagree — no matter how many seconds "in the
  // future" the record claims to be. To actually land in that window, the
  // record must sit on the *following* calendar day, with `now` sitting just
  // before that day's midnight.
  it('does not roll back when the record is a few seconds into the next calendar day', () => {
    const now = new Date(2026, 6, 15, 23, 59, 59); // local: 15 Jul 2026 23:59:59
    const r = parseThreadtimeLine('07-16 00:00:04.000  1  1 D T: m', now); // 16 Jul, 5s after now
    expect(new Date(r!.ts).getFullYear()).to.equal(2026);
  });
});
