import { describe, expect, it } from 'vitest';
import type { UiLogLine } from '../src/renderer/src/logBuffer';
import { formatTime, lastProblemLine, lineLevel, logsAsText, visibleLines } from '../src/renderer/src/logView';

let seq = 0;
function line(text: string, stream: UiLogLine['stream'] = 'stdout', extra: Partial<UiLogLine> = {}): UiLogLine {
  return { id: seq++, ts: 0, stream, text, ...extra };
}

const EVERYTHING = { show: 'everything', technical: true, query: '' } as const;

describe('lineLevel', () => {
  it.each(['error', 'Error: socket hang up', 'FATAL: out of memory', 'uncaught TypeError', 'Unhandled exception', 'listen EADDRINUSE :::4723'])(
    '%s is an error',
    (text) => {
      expect(lineLevel(line(text))).toBe('error');
    }
  );

  it.each(['warn: slow', 'WARNING: disk almost full', 'The flag is deprecated'])('%s is a warning', (text) => {
    expect(lineLevel(line(text))).toBe('warn');
  });

  it('is info for anything else, whatever the stream', () => {
    for (const stream of ['stdout', 'stderr', 'system'] as const) {
      expect(lineLevel(line('Appium REST http interface listener started', stream))).toBe('info');
    }
  });

  it('puts an error before a warning in the same line', () => {
    expect(lineLevel(line('warn: then an error happened'))).toBe('error');
  });

  it('matches whole words only', () => {
    expect(lineLevel(line('terrorist errors warnings'))).toBe('info');
    expect(lineLevel(line('ErrorHandler registered'))).toBe('info');
  });

  it('is not decided by the stream: stderr that says nothing bad is info', () => {
    expect(lineLevel(line('Debugger attached.', 'stderr'))).toBe('info');
  });

  // The server's coloured words arrive wrapped in escape codes: "\x1b[31merror\x1b[39m" has no word
  // break between "31m" and "error" until the codes are taken away.
  it('reads the words the person sees, not the colour codes around them', () => {
    expect(lineLevel(line('\x1b[31merror\x1b[39m: bad'))).toBe('error');
    expect(lineLevel(line('\x1b[33mwarn\x1b[39m: slow'))).toBe('warn');
  });
});

describe('visibleLines', () => {
  const launching = line('Launching: /usr/local/bin/appium server', 'system');
  const home = line('APPIUM_HOME=/Users/qa/.appium', 'system');
  const stopping = line('Stopping Xenon…', 'system', { always: true });
  const info = line('Appium REST http interface listener started');
  const warn = line('warn: slow query');
  const err = line('Error: boom', 'stderr');
  const all = [launching, home, info, warn, stopping, err];

  it('hides system lines without technical details, except those that are always shown', () => {
    expect(visibleLines(all, { ...EVERYTHING, technical: false })).toEqual([info, warn, stopping, err]);
  });

  it('shows "Launching: …" only with technical details', () => {
    expect(visibleLines([launching, info], { ...EVERYTHING, technical: false })).toEqual([info]);
    expect(visibleLines([launching, info], { ...EVERYTHING, technical: true })).toEqual([launching, info]);
  });

  it('always shows a system line marked always, with technical details off', () => {
    const exited = line('Process exited (code=1, signal=null)', 'system', { always: true });
    expect(visibleLines([exited], { ...EVERYTHING, technical: false })).toEqual([exited]);
    expect(visibleLines([exited], { ...EVERYTHING, technical: true })).toEqual([exited]);
  });

  it('does not hide stdout or stderr lines when technical details are off', () => {
    expect(visibleLines([info, err], { ...EVERYTHING, technical: false })).toEqual([info, err]);
  });

  it('keeps only warnings and errors for problems', () => {
    expect(visibleLines(all, { show: 'problems', technical: true, query: '' })).toEqual([warn, err]);
  });

  it('applies the system-line rule to problems too: a technical-only line that says error stays hidden', () => {
    const odd = line('⚠ Renderer process gone: error', 'system');
    expect(visibleLines([odd, err], { show: 'problems', technical: false, query: '' })).toEqual([err]);
    expect(visibleLines([odd, err], { show: 'problems', technical: true, query: '' })).toEqual([odd, err]);
  });

  it('matches the query as a case-insensitive substring', () => {
    expect(visibleLines(all, { ...EVERYTHING, query: 'SLOW' })).toEqual([warn]);
    expect(visibleLines(all, { ...EVERYTHING, query: 'listener' })).toEqual([info]);
    expect(visibleLines(all, { ...EVERYTHING, query: 'no such text' })).toEqual([]);
  });

  it('searches the words that show, not the colour codes', () => {
    const coloured = line('\x1b[38;5;120m[xenon]\x1b[0m ready');
    expect(visibleLines([coloured], { ...EVERYTHING, query: '[xenon] ready' })).toEqual([coloured]);
    expect(visibleLines([coloured], { ...EVERYTHING, query: '38;5' })).toEqual([]);
  });

  it('treats a query of only spaces as no query, and ignores spaces around the words', () => {
    expect(visibleLines(all, { ...EVERYTHING, query: '   ' })).toEqual(all);
    expect(visibleLines(all, { ...EVERYTHING, query: '  slow ' })).toEqual([warn]);
  });

  it('combines show, technical and query, in order', () => {
    expect(visibleLines(all, { show: 'problems', technical: false, query: 'boom' })).toEqual([err]);
    expect(visibleLines(all, { show: 'problems', technical: false, query: 'launching' })).toEqual([]);
  });

  it('keeps the lines themselves (same objects, same ids, same order)', () => {
    const out = visibleLines(all, EVERYTHING);
    expect(out).toEqual(all);
    out.forEach((l, i) => expect(l).toBe(all[i]));
  });

  it('answers an empty list with an empty list', () => {
    expect(visibleLines([], EVERYTHING)).toEqual([]);
  });
});

describe('visibleLines: the line Logs was sent to (keepId)', () => {
  const launching = line('Launching: /usr/local/bin/appium server', 'system');
  const ordinary = line('Appium REST http interface listener started');
  const stderrInfo = line('[Appium] Node version must be at least ^20.19.0', 'stderr');
  const err = line('Error: boom', 'stderr');
  const all = [launching, ordinary, stderrInfo, err];
  const PROBLEMS = { show: 'problems', technical: false, query: '' } as const;

  it('keeps its line in Problems only, though the line is not a problem', () => {
    expect(visibleLines(all, PROBLEMS)).toEqual([err]);
    expect(visibleLines(all, { ...PROBLEMS, keepId: stderrInfo.id })).toEqual([stderrInfo, err]);
  });

  it('keeps its line through a query that does not match it, and filters the others as before', () => {
    expect(visibleLines(all, { ...EVERYTHING, query: 'boom', keepId: ordinary.id })).toEqual([ordinary, err]);
    expect(visibleLines(all, { ...EVERYTHING, query: 'no such text', keepId: stderrInfo.id })).toEqual([stderrInfo]);
  });

  it('keeps a technical-only system line with technical details off', () => {
    expect(visibleLines(all, { ...EVERYTHING, technical: false, keepId: launching.id })).toEqual(all);
    expect(visibleLines(all, { ...EVERYTHING, technical: false })).toEqual([ordinary, stderrInfo, err]);
  });

  it('keeps its line whatever show, technical and query say together', () => {
    const o = { show: 'problems', technical: false, query: 'zzz', keepId: launching.id } as const;
    expect(visibleLines(all, o)).toEqual([launching]);
  });

  it('keeps the order of the lines, the kept one among them', () => {
    expect(visibleLines(all, { ...PROBLEMS, keepId: ordinary.id }).map((l) => l.id)).toEqual([ordinary.id, err.id]);
  });

  it('changes nothing for an id no line has', () => {
    for (const o of [PROBLEMS, EVERYTHING, { ...EVERYTHING, technical: false, query: 'boom' }] as const) {
      expect(visibleLines(all, { ...o, keepId: -1 })).toEqual(visibleLines(all, o));
    }
  });

  it('changes nothing when keepId is left out', () => {
    expect(visibleLines(all, { ...PROBLEMS, keepId: undefined })).toEqual(visibleLines(all, PROBLEMS));
  });
});

// Home quotes lastProblemLine and "See what happened" opens Logs on Problems only at that line
// (keepId), so the quoted line must always be in the view that opens, whatever kind of line it is.
describe('lastProblemLine and the view Logs opens on', () => {
  /** What Logs opens on from Home: Problems only, technical details off, no search, the quoted line kept. */
  const openedFrom = (lines: UiLogLine[]) => {
    const quoted = lastProblemLine(lines);
    if (!quoted) return null;
    return { quoted, shown: visibleLines(lines, { show: 'problems', technical: false, query: '', keepId: quoted.id }) };
  };

  const launching = line('Launching: /usr/local/bin/appium server', 'system');
  const hidden = line('⚠ Renderer process gone: reason=crashed (uncaught exception)', 'system');
  const exited = line('Process exited (code=1, signal=null)', 'system', { always: true });
  const fixtures: Record<string, UiLogLine[]> = {
    'an error line': [launching, line('starting'), line('Error: Cannot find module "xenon"', 'stderr'), exited],
    'a stderr line with no error word': [
      launching,
      line('starting'),
      line('[Appium] Node version must be at least ^20.19.0 but 18.20.4 is installed', 'stderr'),
      exited
    ],
    'an error before a later stderr line': [line('Error: first'), line('npm notice update available', 'stderr'), exited],
    'a technical-only system line that says error': [line('Error: real one', 'stderr'), hidden, exited]
  };

  it.each(Object.keys(fixtures))('quotes a line the view shows: %s', (name) => {
    const opened = openedFrom(fixtures[name]);
    expect(opened).not.toBeNull();
    expect(opened!.shown).toContain(opened!.quoted);
  });

  it('needs keepId when the quoted line is a stderr line with no error word', () => {
    const lines = fixtures['a stderr line with no error word'];
    const quoted = lastProblemLine(lines)!;
    expect(quoted.text).toMatch(/^\[Appium\] Node version must be at least/);
    expect(lineLevel(quoted)).toBe('info');
    expect(visibleLines(lines, { show: 'problems', technical: false, query: '' })).not.toContain(quoted);
    expect(visibleLines(lines, { show: 'problems', technical: false, query: '', keepId: quoted.id })).toContain(quoted);
  });
});

describe('formatTime', () => {
  it('is the local time as HH:MM:SS', () => {
    expect(formatTime(new Date(2026, 9, 6, 14, 3, 9).getTime())).toBe('14:03:09');
  });

  it('pads single digits and reads midnight as 00:00:00', () => {
    expect(formatTime(new Date(2026, 0, 2, 0, 0, 0).getTime())).toBe('00:00:00');
    expect(formatTime(new Date(2026, 0, 2, 9, 5, 7, 999).getTime())).toBe('09:05:07');
  });

  it('uses 24 hours', () => {
    expect(formatTime(new Date(2026, 5, 1, 23, 59, 59).getTime())).toBe('23:59:59');
  });
});

describe('lastProblemLine', () => {
  it('is null when there is nothing to quote', () => {
    expect(lastProblemLine([])).toBeNull();
    expect(lastProblemLine([line('all good'), line('still fine', 'system')])).toBeNull();
  });

  it('is the last error line', () => {
    const first = line('Error: first');
    const last = line('Fatal: last');
    expect(lastProblemLine([first, line('between'), last, line('after')])).toBe(last);
  });

  it('prefers an error over a later stderr line', () => {
    const err = line('Error: bad config');
    const later = line('npm notice something else', 'stderr');
    expect(lastProblemLine([err, later])).toBe(err);
  });

  it('falls back to the last stderr line when no line is an error', () => {
    const early = line('Debugger attached.', 'stderr');
    const last = line('Waiting for the debugger…', 'stderr');
    expect(lastProblemLine([early, line('ordinary'), last, line('ordinary again')])).toBe(last);
  });

  it('does not take a warning as a problem on its own', () => {
    expect(lastProblemLine([line('warn: slow')])).toBeNull();
  });

  it('counts an error in a system line that always shows (a process error)', () => {
    const failed = line('Process error: spawn appium ENOENT', 'system', { always: true });
    expect(lastProblemLine([line('hello'), failed])).toBe(failed);
  });

  // Home quotes this line and Logs scrolls to it, with technical details off. A line that only
  // shows with them on would be quoted but never found.
  it('skips a system line that only shows with technical details', () => {
    const quoted = line('Error: boom', 'stderr');
    const hidden = line('⚠ Renderer process gone: reason=crashed (uncaught exception)', 'system');
    expect(lastProblemLine([quoted, hidden])).toBe(quoted);
    expect(lastProblemLine([hidden])).toBeNull();
  });

  it('reads the words that show, not the colour codes', () => {
    const coloured = line('\x1b[31merror\x1b[39m: bad');
    expect(lastProblemLine([coloured])).toBe(coloured);
  });
});

describe('logsAsText', () => {
  const at = (h: number, m: number, s: number) => new Date(2026, 9, 6, h, m, s).getTime();

  it('is one "HH:MM:SS text" line per log line, joined by newlines', () => {
    const lines = [
      line('first', 'stdout', { ts: at(9, 0, 1) }),
      line('second', 'stderr', { ts: at(9, 0, 2) })
    ];
    expect(logsAsText(lines)).toBe('09:00:01 first\n09:00:02 second');
  });

  it('is empty for no lines', () => {
    expect(logsAsText([])).toBe('');
  });

  it('leaves out the colour codes, so a pasted or saved log reads as it did on screen', () => {
    const coloured = line('\x1b[38;5;120m[xenon]\x1b[0m ready', 'stdout', { ts: at(10, 11, 12) });
    expect(logsAsText([coloured])).toBe('10:11:12 [xenon] ready');
  });
});
