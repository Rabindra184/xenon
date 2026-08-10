import { describe, it, expect } from 'vitest';
import {
  RECORDING_MAX_LINES,
  appendToRecording,
  formatLine,
  recordingFilename,
  serializeRecording,
  startRecording,
} from './logcatRecording';

const rec = (over: Record<string, unknown> = {}) =>
  ({
    ts: Date.UTC(2026, 7, 9, 16, 11, 0, 5),
    pid: 1408,
    tid: 1408,
    level: 'D',
    tag: 'Tile.WifiTile',
    message: 'handleUpdateState',
    pkg: 'com.android.systemui',
    ...over,
  }) as any;

describe('formatLine', () => {
  it('matches the shape the EXPORT button writes, so the two are diffable', () => {
    expect(formatLine(rec())).toBe(
      '2026-08-09T16:11:00.005Z 1408 D/Tile.WifiTile: handleUpdateState',
    );
  });

  it('keeps a multi-line message intact rather than splitting the record', () => {
    // A wrapped logcat message is ONE record whose text contains a newline.
    // Splitting it here would turn one event into two lines that no longer
    // carry a timestamp or level on the second.
    const line = formatLine(rec({ message: 'first\nwrapped remainder' }));
    expect(line).toContain('first\nwrapped remainder');
    expect(line.startsWith('2026-08-09T16:11:00.005Z')).toBe(true);
  });
});

describe('appendToRecording', () => {
  it('captures every record, in order', () => {
    const s = startRecording(0);
    appendToRecording(s, [rec({ message: 'a' }), rec({ message: 'b' })]);
    appendToRecording(s, [rec({ message: 'c' })]);
    expect(s.lines).toHaveLength(3);
    expect(s.lines.map((l) => l.split(': ').pop())).toEqual(['a', 'b', 'c']);
  });

  // The reason this module exists rather than slicing the display buffer: the
  // capture must not be subject to the view's 5000-record cap, which holds
  // about a minute of a real device.
  it('keeps far more than the 5000-record display buffer', () => {
    const s = startRecording(0);
    appendToRecording(
      s,
      Array.from({ length: 12_000 }, (_, i) => rec({ message: `m${i}` })),
    );
    expect(s.lines).toHaveLength(12_000);
    expect(s.dropped).toBe(0);
    expect(s.lines[0]).toContain('m0');
  });

  it('mutates in place so a flush does not copy the whole capture', () => {
    const s = startRecording(0);
    const returned = appendToRecording(s, [rec()]);
    expect(returned).toBe(s);
  });

  it('is a no-op for an empty batch', () => {
    const s = startRecording(0);
    appendToRecording(s, []);
    expect(s.lines).toHaveLength(0);
    expect(s.dropped).toBe(0);
  });

  // At the cap it keeps the OLDEST lines. A recording is evidence of a window
  // you chose; dropping the start would move that window silently, where
  // dropping the tail leaves the beginning where you put it.
  it('drops the newest at the cap, never the oldest, and counts what it dropped', () => {
    const s = startRecording(0);
    s.lines = Array.from({ length: RECORDING_MAX_LINES - 2 }, (_, i) => `pre-${i}`);
    appendToRecording(s, [
      rec({ message: 'fits-1' }),
      rec({ message: 'fits-2' }),
      rec({ message: 'dropped-1' }),
      rec({ message: 'dropped-2' }),
    ]);

    expect(s.lines).toHaveLength(RECORDING_MAX_LINES);
    expect(s.lines[0]).toBe('pre-0'); // oldest survived
    expect(s.lines[s.lines.length - 1]).toContain('fits-2');
    expect(s.lines.join('\n')).not.toContain('dropped-1');
    expect(s.dropped).toBe(2);
  });

  it('keeps counting drops across later batches once the cap is reached', () => {
    const s = startRecording(0);
    s.lines = Array.from({ length: RECORDING_MAX_LINES }, () => 'x');
    appendToRecording(s, [rec(), rec()]);
    appendToRecording(s, [rec()]);
    expect(s.dropped).toBe(3);
    expect(s.lines).toHaveLength(RECORDING_MAX_LINES);
  });
});

describe('serializeRecording', () => {
  it('heads the file with the window it captured', () => {
    const s = startRecording(Date.UTC(2026, 7, 9, 16, 11, 0));
    appendToRecording(s, [rec()]);
    const out = serializeRecording(s, Date.UTC(2026, 7, 9, 16, 11, 30), 'DEV-1');

    expect(out).toContain('# device:   DEV-1');
    expect(out).toContain('# started:  2026-08-09T16:11:00.000Z');
    expect(out).toContain('# stopped:  2026-08-09T16:11:30.000Z');
    expect(out).toContain('# duration: 30.0s');
    expect(out).toContain('# lines:    1');
    expect(out).toContain('D/Tile.WifiTile: handleUpdateState');
  });

  // A truncated capture that looks complete is worse than no capture: it gets
  // used as evidence that something did not happen. Said twice, at both ends,
  // because either can be the one a reader sees first.
  it('declares truncation in BOTH the header and the trailer', () => {
    const s = startRecording(0);
    s.dropped = 47;
    const out = serializeRecording(s, 1000, 'DEV-1');
    expect(out).toContain('# TRUNCATED: 47 further line(s)');
    expect(out).toContain('INCOMPLETE');
    expect(out.trimEnd().endsWith('---')).toBe(true);
    expect(out).toContain('47 line(s) not captured');
  });

  it('says nothing about truncation when nothing was dropped', () => {
    const s = startRecording(0);
    appendToRecording(s, [rec()]);
    const out = serializeRecording(s, 1000, 'DEV-1');
    expect(out).not.toContain('TRUNCATED');
    expect(out).not.toContain('INCOMPLETE');
  });

  it('serialises an empty capture without inventing content', () => {
    const s = startRecording(0);
    const out = serializeRecording(s, 5000, 'DEV-1');
    expect(out).toContain('# lines:    0');
    expect(out).not.toContain('TRUNCATED');
  });
});

describe('recordingFilename', () => {
  it('is filesystem-safe — no colons or dots from the ISO stamp', () => {
    const name = recordingFilename('DEV-1', Date.UTC(2026, 7, 9, 16, 11, 0, 5));
    expect(name).toBe('logcat-DEV-1-2026-08-09T16-11-00-005.txt');
    expect(name).not.toMatch(/[:]/);
  });

  it('is stamped with the START, so a file names the moment recording began', () => {
    const a = recordingFilename('DEV-1', Date.UTC(2026, 7, 9, 16, 0, 0));
    const b = recordingFilename('DEV-1', Date.UTC(2026, 7, 9, 17, 0, 0));
    expect(a).not.toBe(b);
  });
});
