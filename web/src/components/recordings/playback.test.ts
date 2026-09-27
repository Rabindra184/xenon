import { describe, expect, it } from 'vitest';
import {
  clampTime,
  formatClock,
  needsResync,
  positionPct,
  tilePhase,
  toOverlay,
  videoTimeMs,
  visibleAt,
} from './playback';

describe('playback rules', () => {
  it('formats a clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(42_900)).toBe('0:42');
    expect(formatClock(252_000)).toBe('4:12');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('places a phone before, inside or after its video', () => {
    expect(tilePhase(10_000, 42_000, 20_000)).toBe('before');
    expect(tilePhase(42_000, 42_000, 20_000)).toBe('playing');
    expect(tilePhase(62_000, 42_000, 20_000)).toBe('after');
    expect(tilePhase(0, -1000, null)).toBe('playing');
    expect(videoTimeMs(50_000, 42_000)).toBe(8000);
    expect(videoTimeMs(0, -1000)).toBe(1000);
  });

  it('resyncs only past 250 ms of drift', () => {
    expect(needsResync(1000, 1250)).toBe(false);
    expect(needsResync(1000, 1251)).toBe(true);
    expect(needsResync(1300, 1000)).toBe(true);
  });

  it('positions a time on the timeline, clamped', () => {
    expect(positionPct(30_000, 120_000)).toBe(25);
    expect(positionPct(200_000, 120_000)).toBe(100);
    expect(positionPct(5, 0)).toBe(0);
    expect(clampTime(-3, 100)).toBe(0);
    expect(clampTime(300, 100)).toBe(100);
  });

  it('shows a mark from its time until its end, or to the end when it has none', () => {
    const marks = [
      { id: 'a', timecodeMs: 1000, endTimecodeMs: 3000 },
      { id: 'b', timecodeMs: 2000, endTimecodeMs: null },
    ];
    expect(visibleAt(marks, 999).map((m) => m.id)).toEqual([]);
    expect(visibleAt(marks, 1000).map((m) => m.id)).toEqual(['a']);
    expect(visibleAt(marks, 2500).map((m) => m.id)).toEqual(['a', 'b']);
    expect(visibleAt(marks, 3000).map((m) => m.id)).toEqual(['b']);
  });

  it('turns a stored mark into an overlay mark, skipping bad geometry', () => {
    const base = {
      id: 'a',
      recordingId: 'r',
      timecodeMs: 0,
      endTimecodeMs: null,
      shape: 'RECT',
      color: 'red',
      text: null,
    };
    expect(toOverlay({ ...base, geometry: '{"x":0.1,"y":0.2,"w":0.3,"h":0.4}' })).toEqual({
      shape: 'RECT',
      color: 'red',
      geometry: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      text: undefined,
    });
    expect(toOverlay({ ...base, geometry: 'not json' })).toBeNull();
    expect(toOverlay({ ...base, geometry: '{"w":1}' })).toBeNull();
  });
});
