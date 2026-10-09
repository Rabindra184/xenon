import { describe, expect, it } from 'vitest';
import type { LogLine } from '../src/shared/types';
import { LOGS } from '../src/renderer/src/copy/logs';
import { LOG_BUFFER_LIMIT } from '../src/renderer/src/logBuffer';
import {
  LOG_LINES_KEPT,
  crashLineOf,
  emptyReason,
  formatTime,
  lastProblemLine,
  logFileText,
  lineLevel,
  logsAsText,
  nearEnd,
  visibleLines
} from '../src/shared/logView';

let seq = 1;
function line(text: string, stream: LogLine['stream'] = 'stdout', extra: Partial<LogLine> = {}): LogLine {
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

  // R63: Xenon marks its own errors with ❌ and its warnings with ⚠️, often with no error word.
  const LIVE_XENON_ERROR =
    "[xenon] [SessionLifecycleService] ❌ Session validation failed: [Xenon] Invalid Capability: 'platformName' - platformName must be one of: android, ios, tvos";

  it('reads Xenon’s ❌ as an error, with no error word in the line (R63)', () => {
    expect(lineLevel(line(LIVE_XENON_ERROR, 'stderr'))).toBe('error');
    expect(lineLevel(line('❌ boom'))).toBe('error');
  });

  it('reads Xenon’s ⚠ as a warning, with or without the emoji selector (R63)', () => {
    expect(lineLevel(line('[Xenon] ⚠️ Failed to check Stream Service: connect ECONNREFUSED'))).toBe('warn');
    expect(lineLevel(line('⚠ low disk'))).toBe('warn');
  });

  // R79: two common tester mistakes Appium prints with no warning word: a client sent to an address
  // with no route (a base path left out), and a server with no drivers. Problems only shows them.
  it.each([
    '[HTTP] No route found for /session',
    '\u001b[38;5;111m[HTTP]\u001b[39m No route found for /wd/hub/session',
    '[Appium] No drivers have been installed in /Users/tester/.appium. Use the "appium driver" command to install the one(s) you want to use.'
  ])('reads %j as a warning (R79)', (text) => {
    expect(lineLevel(line(text))).toBe('warn');
    expect(visibleLines([line('[Appium] ordinary'), line(text)], { show: 'problems', technical: false, query: '' })).toHaveLength(1);
  });

  it('leaves a request that ended in 404 alone: a bare status is no mistake of its own (R79)', () => {
    expect(lineLevel(line('[HTTP] <-- POST /session 404 3 ms - 135'))).toBe('info');
    expect(lineLevel(line('[HTTP] <-- GET /status 404 1 ms - 70'))).toBe('info');
  });

  it('leaves Xenon’s ✅ and the words failed and failure alone (R63)', () => {
    expect(lineLevel(line('✅ No active sessions to recover.'))).toBe('info');
    expect(lineLevel(line('Request failed, retrying'))).toBe('info');
    expect(lineLevel(line('a failure to connect, retrying'))).toBe('info');
  });

  it('shows Xenon’s ❌ line under Problems only, with nothing keeping it in view (R63)', () => {
    const live = line(LIVE_XENON_ERROR, 'stderr');
    const lines = [line('[Appium] ordinary'), live, line('✅ No active sessions to recover.')];
    expect(visibleLines(lines, { show: 'problems', technical: false, query: '' })).toEqual([live]);
  });

  it('makes Xenon’s ❌ line the last problem, ahead of a later plain stderr line (R63)', () => {
    const live = line(LIVE_XENON_ERROR, 'stderr');
    const laterStderr = line('Debugger attached.', 'stderr');
    expect(lastProblemLine([line('starting'), live, laterStderr])).toBe(live);
  });

  // R68: a crash's exit line has no error word, but it is how the server ended unexpectedly.
  it('is an error for a line main marks as a problem (a crash’s exit line), whatever its words (R68)', () => {
    const exit = line('Process exited (code=null, signal=SIGKILL)', 'system', { always: true, problem: true });
    expect(lineLevel(exit)).toBe('error');
    expect(lineLevel({ ...exit, problem: undefined })).toBe('info');
  });

  it('keeps a crash’s exit line under Problems only, with technical details off (R68)', () => {
    const exit = line('Process exited (code=null, signal=SIGKILL)', 'system', { always: true, problem: true });
    const lines = [line('[Appium] Welcome to Appium'), exit];
    expect(visibleLines(lines, { show: 'problems', technical: false, query: '' })).toEqual([exit]);
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
  const openedFrom = (lines: LogLine[]) => {
    const quoted = lastProblemLine(lines);
    if (!quoted) return null;
    return { quoted, shown: visibleLines(lines, { show: 'problems', technical: false, query: '', keepId: quoted.id }) };
  };

  const launching = line('Launching: /usr/local/bin/appium server', 'system');
  const hidden = line('⚠ Renderer process gone: reason=crashed (uncaught exception)', 'system');
  const exited = line('Process exited (code=1, signal=null)', 'system', { always: true });
  const fixtures: Record<string, LogLine[]> = {
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

  // R68: the quote is always the server's own words. The app's own lines say how it ended, and Home
  // says that in its sentence; a quote of "Process exited…" would only repeat it.
  it('skips the app’s own system lines, even one that always shows or is marked a problem (R68)', () => {
    const failed = line('Process error: spawn appium ENOENT', 'system', { always: true });
    expect(lastProblemLine([line('hello'), failed])).toBeNull();
    const exit = line('Process exited (code=null, signal=SIGKILL)', 'system', { always: true, problem: true });
    const err = line('[Appium] Error: listen EADDRINUSE', 'stderr');
    expect(lastProblemLine([err, line('after'), exit])).toBe(err);
    expect(lastProblemLine([line('ordinary'), exit])).toBeNull();
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

// R67: main works out the crash's line once, from its own lines, and puts it in the server's state.
describe('crashLineOf', () => {
  it('is the line lastProblemLine finds: its id, and its words without colour codes', () => {
    const err = line('\x1b[31m[Appium]\x1b[39m Error: boom', 'stderr');
    const later = line('[Appium] ordinary');
    expect(crashLineOf([err, later])).toEqual({ id: err.id, text: '[Appium] Error: boom' });
  });

  it('is null when there is no problem line, so Home quotes nothing and Logs opens as usual', () => {
    expect(crashLineOf([line('[Appium] ordinary'), line('Launching: x', 'system')])).toBeNull();
    expect(crashLineOf([])).toBeNull();
  });

  it('is null after a crash that printed nothing bad: the exit line is the app’s own (R68)', () => {
    const exit = line('Process exited (code=null, signal=SIGKILL)', 'system', { always: true, problem: true });
    expect(crashLineOf([line('[Appium] Welcome to Appium'), exit])).toBeNull();
  });

  it('quotes a stderr line with no error word, the one Logs must keep in view (keepId)', () => {
    const stderr = line('[Appium] Node version must be at least 20.19.0', 'stderr');
    const quote = crashLineOf([line('ok'), stderr]);
    expect(quote).toEqual({ id: stderr.id, text: stderr.text });
    expect(visibleLines([stderr], { show: 'problems', technical: false, query: '', keepId: quote!.id })).toEqual([stderr]);
  });
});

// R67: main and the window keep the same lines, so the window's buffer is no bigger and no smaller than main's.
describe('LOG_LINES_KEPT', () => {
  it('is how many lines main keeps, and the window keeps as many', () => {
    expect(LOG_LINES_KEPT).toBe(5000);
    expect(LOG_BUFFER_LIMIT).toBe(LOG_LINES_KEPT);
  });
});

describe('emptyReason', () => {
  const o = (show: 'everything' | 'problems', query = '') => ({ show, query });

  it('is null while any line is shown', () => {
    expect(emptyReason(3, 1, o('problems', 'boom'))).toBeNull();
  });

  it('says no output yet when there are no lines at all, whatever is chosen', () => {
    expect(emptyReason(0, 0, o('everything'))).toBe('no-output');
    expect(emptyReason(0, 0, o('problems'))).toBe('no-output');
    expect(emptyReason(0, 0, o('everything', 'boom'))).toBe('no-output');
  });

  it('says nothing matches a search that finds no line', () => {
    expect(emptyReason(5, 0, o('everything', 'boom'))).toBe('no-match');
    expect(emptyReason(5, 0, o('problems', 'boom'))).toBe('no-match');
  });

  it('says no problems so far for Problems only with no search', () => {
    expect(emptyReason(5, 0, o('problems'))).toBe('no-problems');
    expect(emptyReason(5, 0, o('problems', '   '))).toBe('no-problems');
  });

  it('says no output yet when the only lines are for technical details', () => {
    expect(emptyReason(2, 0, o('everything'))).toBe('no-output');
  });
});

describe('nearEnd', () => {
  it('is true at the end and within a few pixels of it', () => {
    expect(nearEnd({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(nearEnd({ scrollTop: 590, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });

  it('is false while the person reads higher up', () => {
    expect(nearEnd({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  it('is true when everything fits', () => {
    expect(nearEnd({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true);
  });
});

// R70: Save as… writes a header line first, and ends the file with a newline. Copy stays lines only.
describe('logFileText', () => {
  const at = (h: number, m: number, s: number) => new Date(2026, 9, 8, h, m, s).getTime();

  it('is the header, then one "HH:MM:SS text" line per log line, and a newline at the end', () => {
    const lines = [line('first', 'stdout', { ts: at(9, 0, 1) }), line('\x1b[31msecond\x1b[39m', 'stderr', { ts: at(9, 0, 2) })];
    expect(logFileText('Xenon Control log · 8 October 2026 · Everything · 2 of 2 lines', lines)).toBe(
      'Xenon Control log · 8 October 2026 · Everything · 2 of 2 lines\n09:00:01 first\n09:00:02 second\n'
    );
  });

  it('leaves Copy’s text as it was: lines only, no header, no newline at the end', () => {
    const lines = [line('only', 'stdout', { ts: at(9, 0, 1) })];
    expect(logsAsText(lines)).toBe('09:00:01 only');
  });
});

describe('copy/logs: the saved file’s header (R70)', () => {
  const date = new Date(2026, 9, 8, 23, 59);

  it('names the app, the day in British English, what is shown, and how many of how many lines', () => {
    expect(LOGS.fileHeader({ date, show: 'everything', query: '', shown: 3, total: 3 })).toBe(
      'Xenon Control log · 8 October 2026 · Everything · 3 of 3 lines'
    );
    expect(LOGS.fileHeader({ date, show: 'problems', query: '', shown: 2, total: 1204 })).toBe(
      'Xenon Control log · 8 October 2026 · Problems only · 2 of 1,204 lines'
    );
  });

  it('adds the search, in curly quotes and as typed without the spaces around it, only when there is one', () => {
    expect(LOGS.fileHeader({ date, show: 'problems', query: '  EADDRINUSE ', shown: 1, total: 5000 })).toBe(
      'Xenon Control log · 8 October 2026 · Problems only · search “EADDRINUSE” · 1 of 5,000 lines'
    );
    expect(LOGS.fileHeader({ date, show: 'everything', query: '   ', shown: 2, total: 2 })).toBe(
      'Xenon Control log · 8 October 2026 · Everything · 2 of 2 lines'
    );
  });

  it('says 1 line in the singular, as the count does', () => {
    expect(LOGS.fileHeader({ date, show: 'everything', query: '', shown: 1, total: 1 })).toBe(
      'Xenon Control log · 8 October 2026 · Everything · 1 of 1 line'
    );
    expect(LOGS.fileHeader({ date: new Date(2027, 0, 1), show: 'problems', query: 'x', shown: 0, total: 2 })).toBe(
      'Xenon Control log · 1 January 2027 · Problems only · search “x” · 0 of 2 lines'
    );
  });
});

describe('copy/logs', () => {
  it('counts one line in the singular, and groups thousands as Part A did', () => {
    expect(LOGS.lines(0)).toBe('0 lines');
    expect(LOGS.lines(1)).toBe('1 line');
    expect(LOGS.lines(2)).toBe('2 lines');
    expect(LOGS.lines(5000)).toBe('5,000 lines');
    expect(LOGS.lines(1234567)).toBe('1,234,567 lines');
  });

  it('has the words for each empty view and for a save that failed, as ruled (R61)', () => {
    expect(LOGS.empty.text).toBe('No output yet…');
    expect(LOGS.empty.noProblems).toBe('No problems so far.');
    expect(LOGS.empty.noMatch).toBe('No lines match your search.');
    expect(LOGS.saveFailed).toBe('Couldn’t save the log. Try another folder.');
  });
});
