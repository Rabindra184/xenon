import { describe, it, expect } from 'vitest';
import {
  logTimestamp,
  logRowKind,
  prettyJson,
  tokenizeJson,
  filterErrorsOnly,
  formatTabCount,
  logDisplayTitle,
  logDisplaySubtitle,
} from './log-derive';

describe('logTimestamp', () => {
  it('formats ISO string as HH:MM:SS', () => {
    const out = logTimestamp({ timestamp: '2026-04-23T08:31:42Z' });
    expect(out).to.match(/^\d{2}:\d{2}:42$/);
  });
  it('falls back to createdAt when no timestamp', () => {
    const out = logTimestamp({ createdAt: '2026-04-23T08:31:42Z' } as any);
    expect(out).to.match(/^\d{2}:\d{2}:42$/);
  });
  it('returns dashes for invalid input', () => {
    expect(logTimestamp({ timestamp: 'not a date' })).to.equal('--:--:--');
    expect(logTimestamp({})).to.equal('--:--:--');
  });
});

describe('logRowKind', () => {
  // SessionLog.is_healed is the field the server writes (event-manager.ts).
  it('marks healed rows amber', () => {
    expect(logRowKind({ is_healed: true, is_success: true } as any).tone).to.equal('amber');
  });
  it('marks failed rows red', () => {
    expect(logRowKind({ is_success: false, command_name: 'click' }).tone).to.equal('red');
    expect(logRowKind({ is_success: false, command_name: 'click' }).label).to.equal('click');
  });
  it('marks successful rows green', () => {
    expect(logRowKind({ is_success: true, command_name: 'tap' }).tone).to.equal('green');
  });
  it('infers from event/title — stop=red, start=green', () => {
    expect(logRowKind({ title: 'session_stopped' } as any).tone).to.equal('red');
    expect(logRowKind({ event: 'session_started' } as any).tone).to.equal('green');
    expect(logRowKind({ command_name: 'init' } as any).tone).to.equal('green');
  });
  it('falls back to neutral with label "log"', () => {
    expect(logRowKind({}).tone).to.equal('neutral');
    expect(logRowKind({}).label).to.equal('log');
  });
});

describe('prettyJson', () => {
  it('returns "" for nullish', () => {
    expect(prettyJson(null)).to.equal('');
    expect(prettyJson(undefined)).to.equal('');
  });
  it('round-trips a JSON string', () => {
    expect(prettyJson('{"a":1}')).to.equal('{\n  "a": 1\n}');
  });
  it('returns plain string when not JSON', () => {
    expect(prettyJson('just a string')).to.equal('just a string');
  });
  it('formats objects', () => {
    expect(prettyJson({ a: 1 })).to.equal('{\n  "a": 1\n}');
  });
});

describe('tokenizeJson', () => {
  it('classifies keys vs string values', () => {
    const t = tokenizeJson('{"a":"b"}');
    const kinds = t.map((x) => x.kind);
    // We expect: punct({), key("a"), punct(:), string("b"), punct(})
    expect(kinds).to.contain('key');
    expect(kinds).to.contain('string');
    expect(kinds).to.contain('punct');
  });
  it('classifies numbers, booleans, null', () => {
    const t = tokenizeJson('{"n":1,"b":true,"u":null}');
    const kinds = t.map((x) => x.kind);
    expect(kinds).to.contain('number');
    expect(kinds).to.contain('boolean');
    expect(kinds).to.contain('null');
  });
  it('handles empty/non-string input gracefully', () => {
    expect(tokenizeJson('')).to.eql([{ text: '', kind: 'plain' }]);
    expect(tokenizeJson(null as any)[0].kind).to.equal('plain');
  });
});

describe('filterErrorsOnly', () => {
  it('passes through when off', () => {
    const logs = [{ is_success: true }, { is_success: false }] as any;
    expect(filterErrorsOnly(logs, false)).to.have.lengthOf(2);
  });
  it('keeps only is_success=false rows when on', () => {
    const logs = [{ is_success: true }, { is_success: false }, {}] as any;
    expect(filterErrorsOnly(logs, true)).to.have.lengthOf(1);
  });
  it('keeps an is_error row too', () => {
    const logs = [{ is_success: true }, { is_error: true }] as any;
    expect(filterErrorsOnly(logs, true)).to.have.lengthOf(1);
  });
});

describe('log display derivation', () => {
  const dbRow = {
    id: 'slog-3',
    session_id: 'sess-audit-2',
    command_name: 'findElement',
    title: 'Find Element',
    subtitle: 'accessibility id: btn_place_order',
    response: '{"error":"no such element"}',
  };

  it('prefers title over raw JSON', () => {
    expect(logDisplayTitle(dbRow as any)).toBe('Find Element');
  });

  it('falls back to command_name then a generic label', () => {
    expect(logDisplayTitle({ command_name: 'click' } as any)).toBe('click');
    expect(logDisplayTitle({} as any)).toBe('Command');
  });

  it('exposes the subtitle when present', () => {
    expect(logDisplaySubtitle(dbRow as any)).toBe('accessibility id: btn_place_order');
    expect(logDisplaySubtitle({} as any)).toBeNull();
  });
});

describe('formatTabCount', () => {
  it('keeps a tab short', () => {
    expect(formatTabCount(48)).to.equal('48');
    expect(formatTabCount(2674)).to.equal('2.7k');
    expect(formatTabCount(3000)).to.equal('3k');
  });
});

// Device and debug logs are Log rows: { id, session_id, log_type, message,
// timestamp }. They have none of a command's fields, so through 2.13.1 every
// row read "log · Command" and the line itself was never shown.
describe('device and debug log lines', () => {
  const line = (message: string, log_type = 'DEVICE') => ({
    id: 'l1',
    session_id: 's1',
    log_type,
    message,
    timestamp: '2026-10-04T09:13:10Z',
  });
  const logcatError = line('10-04 09:13:10.120  4127  4127 E ShopCheckout: payment failed');
  const logcatWarn = line('10-04 09:13:10.140  4127  4127 W OkHttp: retrying in 500 ms');
  const logcatInfo = line(
    '10-04 09:13:10.160  1201  1340 I ActivityTaskManager: Displayed com.example.shop/.Main',
  );
  const briefFatal = line('F/libc    ( 4127): Fatal signal 11 (SIGSEGV)');
  const iosError = line(
    'Oct  4 09:13:10 iPhone SpringBoard(FrontBoard)[57] <Error>: Failed to launch',
  );
  const iosWarning = line('Oct  4 09:13:11 iPhone backboardd[61] <Warning>: slow touch');
  const debug = line('Reached the checkout screen', 'DEBUG');

  it('shows the line itself, not a generic label', () => {
    expect(logDisplayTitle(logcatInfo)).toBe(logcatInfo.message);
    expect(logDisplayTitle(debug)).toBe('Reached the checkout screen');
    expect(logDisplaySubtitle(logcatInfo)).toBeNull();
  });

  it("shows only a long message's first line in the row", () => {
    expect(logDisplayTitle(line('payment failed\n\tat Pay.run(Pay.java:42)'))).toBe(
      'payment failed',
    );
  });

  it('marks a line by the level it carries', () => {
    expect(logRowKind(logcatError)).toEqual({ label: 'error', tone: 'red' });
    expect(logRowKind(briefFatal)).toEqual({ label: 'error', tone: 'red' });
    expect(logRowKind(iosError)).toEqual({ label: 'error', tone: 'red' });
    expect(logRowKind(logcatWarn)).toEqual({ label: 'warn', tone: 'amber' });
    expect(logRowKind(iosWarning)).toEqual({ label: 'warn', tone: 'amber' });
    expect(logRowKind(logcatInfo)).toEqual({ label: '', tone: 'neutral' });
    expect(logRowKind(debug)).toEqual({ label: '', tone: 'neutral' });
  });

  it('keeps the error lines when only errors are shown', () => {
    const all = [logcatError, logcatWarn, logcatInfo, briefFatal, iosError, iosWarning, debug];
    expect(filterErrorsOnly(all, true)).toEqual([logcatError, briefFatal, iosError]);
  });

  // As the server saves an Android session's lines (deviceLogBook.ts
  // formatThreadtime): logcat's own layout, a short tag padded to 8 columns.
  it("reads an Android session's saved lines and Xenon's notes among them", () => {
    const fatal = line('10-05 09:13:10.120  4127  4127 E AndroidRuntime: FATAL EXCEPTION: main');
    const frame = line(
      '10-05 09:13:10.120  4127  4127 E AndroidRuntime: \tat com.example.Pay.run(Pay.java:42)',
    );
    const abort = line('10-05 09:13:10.300  4127  4140 F DEBUG   : Abort message: boom');
    const chatter = line('10-05 09:13:10.310  1201  1340 D Wifi    : scan done');
    const note = line(
      'Xenon: This session reached 10,000 device log lines. From here on, only errors are kept.',
    );

    expect(logRowKind(abort)).toEqual({ label: 'error', tone: 'red' });
    expect(logRowKind(note)).toEqual({ label: '', tone: 'neutral' });
    expect(logDisplayTitle(note)).toBe(note.message);
    expect(filterErrorsOnly([fatal, frame, chatter, note, abort], true)).toEqual([
      fatal,
      frame,
      abort,
    ]);
  });

  it('leaves a command row as it was, message or not', () => {
    const command = { command_name: 'click', title: 'Click', message: 'ignored' } as any;
    expect(logDisplayTitle(command)).toBe('Click');
    expect(logRowKind({ ...command, is_success: true }).label).toBe('click');
  });
});
