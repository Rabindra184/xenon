import { describe, expect, it } from 'vitest';
import { afterReplay, OVERLAP_LINES } from './replayOverlap';
import { sourceWants } from './iosSourceFilter';

let seq = 0;
const line = (message: string, over: Record<string, unknown> = {}) => ({
  seq: seq++,
  ts: 1000,
  pid: 1,
  tid: 1,
  level: 'D',
  tag: 'T',
  message,
  ...over,
});
/** The same line as the server replays it: same content, a new seq. */
const again = (r: ReturnType<typeof line>) => ({ ...r, seq: seq++ });

describe('afterReplay', () => {
  it('skips the replayed copy of what the client had, up to its newest line', () => {
    const seen = [line('a'), line('b'), line('c')];
    const replay = [again(seen[0]), again(seen[1]), again(seen[2]), line('d')];
    expect(afterReplay(replay, seen)).toBe(3);
  });

  it('skips older history the replay starts with', () => {
    const seen = [line('b'), line('c')];
    const replay = [line('older'), again(seen[0]), again(seen[1]), line('d')];
    expect(afterReplay(replay, seen)).toBe(3);
  });

  it('matches line for line, so one line printed twice in a millisecond lands right', () => {
    // logcat often prints the same line twice in one millisecond: the newest
    // line alone can't say which copy the client had.
    const x = line('same');
    const seen = [line('a'), x, again(x), line('b')];
    const replay = [again(seen[0]), again(x), again(x), again(seen[3]), again(x), line('new')];
    expect(afterReplay(replay, seen)).toBe(4);
  });

  it('answers null while the replay has not reached what the client had', () => {
    const seen = [line('a'), line('b'), line('c')];
    expect(afterReplay([again(seen[0])], seen)).toBeNull();
  });

  it('answers 0 when the client had nothing', () => {
    expect(afterReplay([line('a')], [])).toBe(0);
  });

  it('compares only the newest lines the client had', () => {
    const seen = Array.from({ length: OVERLAP_LINES + 10 }, (_, i) => line(`l${i}`));
    // The replay holds only the newest OVERLAP_LINES of them.
    const replay = [...seen.slice(-OVERLAP_LINES).map(again), line('new')];
    expect(afterReplay(replay, seen)).toBe(OVERLAP_LINES);
  });

  it('leaves out the drop markers only this client was sent', () => {
    const seen = [line('a'), line('b'), line('3 lines dropped', { synthetic: true })];
    const replay = [again(seen[0]), again(seen[1]), line('c')];
    expect(afterReplay(replay, seen)).toBe(2);
  });

  it('compares only the lines the new stream sends (an iPhone narrowed at the source)', () => {
    const err = line('boom', { level: 'E' });
    const seen = [line('info', { level: 'I' }), err, line('more info', { level: 'I' })];
    const replay = [again(err), line('new error', { level: 'E' })];
    const wants = sourceWants({ levels: ['Error', 'Fault'] });
    expect(afterReplay(replay, seen, wants)).toBe(1);
    expect(afterReplay(replay, seen)).toBeNull();
  });
});

describe('sourceWants', () => {
  it('passes everything with no source filter (Android)', () => {
    expect(sourceWants(undefined)(line('x'))).toBe(true);
  });

  it('passes the levels and the app the iPhone stream was asked for', () => {
    const wants = sourceWants({ levels: ['Info', 'Default', 'Error', 'Fault'], process: 'Shop' });
    expect(wants(line('x', { level: 'I', pkg: 'Shop' }))).toBe(true);
    expect(wants(line('x', { level: 'D', pkg: 'Shop' }))).toBe(false);
    expect(wants(line('x', { level: 'E', pkg: 'Other' }))).toBe(false);
  });
});
