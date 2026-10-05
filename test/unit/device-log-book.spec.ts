import { expect } from 'chai';
import {
  DEVICE_LOG_ERROR_LIMIT,
  DEVICE_LOG_LINE_LIMIT,
  DeviceLogBook,
  UNKNOWN_CLOCK,
  WINDOW_SLACK_MS,
  formatThreadtime,
  parseDeviceClock,
} from '../../src/services/logcat/deviceLogBook';
import { parseThreadtimeLine, type LogcatRecord } from '../../src/services/logcat/logcatParse';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A threadtime line logged at `at` by this machine's local clock. */
function lineAt(at: number, level = 'I', msg = 'hello', tag = 'Tag', pid = 4127): string {
  const t = new Date(at);
  return (
    `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:` +
    `${pad(t.getSeconds())}.${pad(t.getMilliseconds(), 3)}  ${pid}  ${pid} ${level} ${tag}: ${msg}`
  );
}

function recAt(at: number, level = 'I', msg = 'hello', tag = 'Tag'): LogcatRecord {
  const rec = parseThreadtimeLine(lineAt(at, level, msg, tag), new Date(at));
  if (!rec) throw new Error('not a line');
  return rec;
}

// The dashboard's own reading of a device log line (web log-derive.ts).
const DASHBOARD_THREADTIME = /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+([VDIWEF])\s/;

// Mid-January, midday: no daylight-saving change within hours of it.
const T0 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();

describe('DeviceLogBook', () => {
  describe('formatThreadtime', () => {
    it('prints a record as logcat printed it, so it parses back the same', () => {
      const line = '01-15 12:00:00.120  4127  4130 E AndroidRuntime: FATAL EXCEPTION: main';
      const rec = parseThreadtimeLine(line, new Date(T0)) as LogcatRecord;

      const printed = formatThreadtime(rec);

      expect(printed).to.equal(line);
      expect(parseThreadtimeLine(printed, new Date(T0))).to.deep.equal(rec);
    });

    it("pads a short tag to logcat's eight columns, and the dashboard reads its level", () => {
      const printed = formatThreadtime(recAt(T0, 'F', 'boom', 'DEBUG'));

      expect(printed).to.match(/ F DEBUG {3}: boom$/);
      expect(DASHBOARD_THREADTIME.exec(printed)?.[1]).to.equal('F');
    });

    it('keeps a wrapped message whole', () => {
      const rec = { ...recAt(T0), message: 'first\nwrapped remainder' };
      expect(formatThreadtime(rec)).to.match(/Tag {5}: first\nwrapped remainder$/);
    });
  });

  describe('the session window', () => {
    it('keeps lines from shortly before the phone was given to the session, and not before', () => {
      const book = new DeviceLogBook({ since: T0, clock: UNKNOWN_CLOCK });

      expect(book.add(recAt(T0 - WINDOW_SLACK_MS - 1))).to.deep.equal([]);
      expect(book.add(recAt(T0 - WINDOW_SLACK_MS))).to.have.length(1);
      expect(book.add(recAt(T0 + 60_000))).to.have.length(1);
    });

    it('stamps each line with its own time, and keeps the text the phone printed', () => {
      const book = new DeviceLogBook({ since: T0, clock: UNKNOWN_CLOCK });

      const [row] = book.add(recAt(T0 + 1234, 'W', 'low memory'));

      expect(row.timestamp.getTime()).to.equal(T0 + 1234);
      expect(row.message).to.equal(
        lineAt(T0 + 1234, 'W', 'low memory').replace('Tag:', 'Tag     :'),
      );
    });

    it('reads a phone in another time zone at the moment it logged, not hours off', () => {
      // The phone is 5 h 30 min ahead: its 17:30 is this server's 12:00.
      const ahead = 5.5 * 3_600_000;
      const book = new DeviceLogBook({ since: T0, clock: { zoneShiftMs: -ahead, skewMs: 0 } });

      // Printed an hour before the session by the phone's clock: left out.
      expect(book.add(recAt(T0 + ahead - 3_600_000))).to.deep.equal([]);
      const [row] = book.add(recAt(T0 + ahead + 5_000));

      expect(row.timestamp.getTime()).to.equal(T0 + 5_000);
      // The text is the phone's own, as it printed it.
      expect(row.message).to.match(/^01-15 17:30:05\.000 /);
    });

    it("cuts and stamps by this server's clock when the phone's runs behind", () => {
      // The phone's clock is 40 s slow: a line it stamps 30 s before the
      // session came 10 s after the session began, and one it stamps 43 s
      // before came 3 s before.
      const book = new DeviceLogBook({ since: T0, clock: { zoneShiftMs: 0, skewMs: 40_000 } });

      expect(book.add(recAt(T0 - 43_000))).to.deep.equal([]);
      const [row] = book.add(recAt(T0 - 30_000));

      expect(row.timestamp.getTime()).to.equal(T0 + 10_000);
      // The text keeps the time the phone printed.
      expect(row.message).to.match(/^01-15 11:59:30\.000 /);
    });

    it("ignores the stream's own notes", () => {
      const book = new DeviceLogBook({ since: T0, clock: UNKNOWN_CLOCK });
      expect(book.add({ ...recAt(T0), tag: 'xenon', synthetic: true })).to.deep.equal([]);
    });
  });

  describe('after an interruption', () => {
    it('counts only lines newer than the last it saw, by content at that millisecond', () => {
      const book = new DeviceLogBook({ since: T0, clock: UNKNOWN_CLOCK });
      book.add(recAt(T0 + 1_000, 'I', 'one'));
      book.add(recAt(T0 + 2_000, 'E', 'stack line 1'));
      book.add(recAt(T0 + 2_000, 'E', 'stack line 2'));

      const [note] = book.interrupted(new Date(T0 + 3_000));
      expect(note.message).to.equal(
        "Xenon: The phone's log was interrupted. Lines may be missing from here.",
      );

      // The new stream's history repeats what was kept...
      expect(book.add(recAt(T0 + 1_000, 'I', 'one'))).to.deep.equal([]);
      expect(book.add(recAt(T0 + 2_000, 'E', 'stack line 1'))).to.deep.equal([]);
      expect(book.add(recAt(T0 + 2_000, 'E', 'stack line 2'))).to.deep.equal([]);
      // ...and has a line of that same millisecond that hadn't arrived yet.
      expect(book.add(recAt(T0 + 2_000, 'E', 'stack line 3'))).to.have.length(1);
      expect(book.add(recAt(T0 + 4_000, 'I', 'after'))).to.have.length(1);
      expect(book.keptLines).to.equal(5);
    });

    it('keeps the session window when nothing had arrived yet', () => {
      const book = new DeviceLogBook({ since: T0, clock: UNKNOWN_CLOCK });
      book.interrupted(new Date(T0));

      expect(book.add(recAt(T0 - 60_000))).to.deep.equal([]);
      expect(book.add(recAt(T0))).to.have.length(1);
    });
  });

  describe('the limit', () => {
    it('keeps every line up to the limit, then errors only, then nothing, and says so', () => {
      const book = new DeviceLogBook({
        since: T0,
        clock: UNKNOWN_CLOCK,
        lineLimit: 3,
        errorLimit: 2,
      });
      const kept: string[] = [];
      const add = (level: string, msg: string, at: number) =>
        kept.push(...book.add(recAt(T0 + at, level, msg)).map((r) => r.message));

      add('D', 'a', 1);
      add('I', 'b', 2);
      add('W', 'c', 3);
      add('I', 'chatter', 4); // past the limit: left out, after the note
      add('E', 'FATAL EXCEPTION: main', 5);
      add('D', 'more chatter', 6);
      add('F', 'abort', 7);
      add('E', 'one error too many', 8);

      expect(kept.map((m) => m.replace(/^.*Tag {5}: /, ''))).to.deep.equal([
        'a',
        'b',
        'c',
        'Xenon: This session reached 3 device log lines. From here on, only errors are kept.',
        'FATAL EXCEPTION: main',
        'abort',
      ]);
      expect(book.finish(new Date(T0 + 9)).map((r) => r.message)).to.deep.equal([
        "Xenon: 3 device log lines were left out to keep this session's log within its limit.",
      ]);
    });

    it('says nothing at the end when nothing was left out', () => {
      const book = new DeviceLogBook({ since: T0, clock: UNKNOWN_CLOCK });
      book.add(recAt(T0));
      expect(book.finish(new Date(T0))).to.deep.equal([]);
    });

    it('is 10,000 lines, then 2,000 errors', () => {
      expect(DEVICE_LOG_LINE_LIMIT).to.equal(10_000);
      expect(DEVICE_LOG_ERROR_LIMIT).to.equal(2_000);
    });
  });

  describe('parseDeviceClock', () => {
    const fields = (at: number) => {
      const t = new Date(at);
      return `${pad(t.getMonth() + 1)}-${pad(t.getDate())}.${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    };

    it("finds a phone's time zone against this server's, to the quarter hour", () => {
      const secs = Math.floor(T0 / 1000);
      const ahead = 5.5 * 3_600_000;
      // The phone prints its local time, 5 h 30 min ahead of this server's.
      const out = `${secs}.348157848.${fields(secs * 1000 + ahead)}\n`;

      const clock = parseDeviceClock(out, T0 + 300);

      expect(clock?.zoneShiftMs).to.equal(-ahead);
      expect(clock?.skewMs).to.equal(300 - 348);
    });

    it('finds a phone in the same zone, its clock 2.8 s slow, as the lab S9+ was', () => {
      const secs = Math.floor(T0 / 1000) - 3;
      const clock = parseDeviceClock(`${secs}.200000000.${fields(secs * 1000)}`, T0);

      expect(clock?.zoneShiftMs).to.equal(0);
      expect(clock?.skewMs).to.equal(2_800);
    });

    it("takes the middle of the second when the phone's date prints no nanoseconds", () => {
      const secs = Math.floor(T0 / 1000) + 7;
      for (const nanos of ['%N', 'N', '']) {
        const clock = parseDeviceClock(`${secs}.${nanos}.${fields(secs * 1000)}`, T0);
        expect(clock?.skewMs, nanos).to.equal(-7_500);
      }
    });

    it("is null for anything that isn't the date it asked for", () => {
      expect(parseDeviceClock('', T0)).to.equal(null);
      expect(parseDeviceClock('date: bad format', T0)).to.equal(null);
      expect(parseDeviceClock('%s.%N.%m-%d.%H:%M:%S', T0)).to.equal(null);
    });
  });
});
