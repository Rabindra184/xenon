import { describe, expect, it } from 'vitest';
import type { RecordingDetail } from '../../api-service/recordings';
import {
  clampTime,
  formatClock,
  needsResync,
  onTimeline,
  PAUSED_RESYNC_MS,
  positionPct,
  tilePhase,
  timelineOriginMs,
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

  it('resyncs only past 250 ms of drift, or past one frame when paused', () => {
    expect(needsResync(1000, 1250)).toBe(false);
    expect(needsResync(1000, 1251)).toBe(true);
    expect(needsResync(1300, 1000)).toBe(true);
    expect(needsResync(1000, 1020, PAUSED_RESYNC_MS)).toBe(false);
    expect(needsResync(1000, 1021, PAUSED_RESYNC_MS)).toBe(true);
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

  it('starts the timeline at the earliest phone with a video, not at a failed one', () => {
    expect(
      timelineOriginMs([
        { offsetMs: -5000, durationMs: null },
        { offsetMs: -1000, durationMs: 20_000 },
      ]),
    ).toBe(-1000);
    expect(timelineOriginMs([{ offsetMs: -5000, durationMs: null }])).toBe(0);
  });

  it('starts the timeline at the earliest frame, moving every time by the same amount', () => {
    const at = (offsetMs: number) => ({ offsetMs, durationMs: 10_000 });
    expect(timelineOriginMs([at(500), at(42_000)])).toBe(0);
    expect(timelineOriginMs([at(-13_000), at(-756)])).toBe(-13_000);

    const phone = { offsetMs: -13_000 } as RecordingDetail['summary']['phones'][number];
    const mark = {
      timecodeMs: 1000,
      endTimecodeMs: 5000,
    } as RecordingDetail['annotations'][number];
    const d = {
      groupId: 'g1',
      summary: { phones: [phone, { ...phone, offsetMs: 0 }] },
      bookmarks: [{ timecodeMs: 6000 }],
      annotations: [mark, { ...mark, endTimecodeMs: null }],
    } as unknown as RecordingDetail;
    const t = onTimeline(d);
    expect(t.summary.phones.map((p) => p.offsetMs)).toEqual([0, 13_000]);
    expect(t.bookmarks.map((b) => b.timecodeMs)).toEqual([19_000]);
    expect(t.annotations.map((a) => [a.timecodeMs, a.endTimecodeMs])).toEqual([
      [14_000, 18_000],
      [14_000, null],
    ]);
    // Nothing started before t=0: the same detail, untouched.
    const late = { ...d, summary: { phones: [{ ...phone, offsetMs: 0 }] } } as RecordingDetail;
    expect(onTimeline(late)).toBe(late);
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
