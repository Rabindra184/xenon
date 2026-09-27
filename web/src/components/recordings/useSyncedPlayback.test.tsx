import * as React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSyncedPlayback, type PlaybackClock, type SyncedPlayback } from './useSyncedPlayback';

function fakeClock() {
  let now = 0;
  let pending: (() => void) | null = null;
  const clock: PlaybackClock = {
    now: () => now,
    schedule: (cb) => {
      pending = cb;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  /** Advance time and run one frame. */
  const step = (ms: number) =>
    act(() => {
      now += ms;
      const cb = pending;
      pending = null;
      cb?.();
    });
  return { clock, step };
}

function fakeVideo(over: Partial<HTMLVideoElement> = {}) {
  let time = 0;
  const v: any = {
    paused: true,
    ended: false,
    // What a browser reports before it has read the file's length.
    duration: NaN,
    readyState: 4,
    error: null,
    get currentTime() {
      return time;
    },
    // As in a browser, seeking back from the end means it is no longer ended.
    set currentTime(t: number) {
      time = t;
      if (Number.isFinite(this.duration) && t < this.duration) this.ended = false;
    },
    // As in a browser (HTML "play()" steps), play() on an ended video rewinds it to 0.
    play: vi.fn(function (this: any) {
      if (this.ended) this.currentTime = 0;
      this.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(function (this: any) {
      this.paused = true;
    }),
  };
  // Assigned rather than spread, so a currentTime override goes through the setter.
  Object.assign(v, over);
  // Not re-bound: the hook only ever calls these as el.play()/el.pause(), so `this`
  // is already `v`. Function.prototype.bind() returns a plain wrapper without the
  // vi.fn() mock's `.mock` bookkeeping, which makes toHaveBeenCalled() throw.
  return v as HTMLVideoElement & {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  };
}

function setup(duration = 60_000) {
  const { clock, step } = fakeClock();
  const api: { current: SyncedPlayback | null } = { current: null };
  function Harness() {
    api.current = useSyncedPlayback(duration, clock);
    return null;
  }
  render(<Harness />);
  const p = () => api.current as SyncedPlayback;
  return { p, step };
}

/** Like setup(), but lets the test change `duration` on a live re-render. */
function setupRerenderable(duration = 60_000) {
  const { clock, step } = fakeClock();
  const api: { current: SyncedPlayback | null } = { current: null };
  function Harness({ duration }: { duration: number }) {
    api.current = useSyncedPlayback(duration, clock);
    return null;
  }
  const { rerender } = render(<Harness duration={duration} />);
  const p = () => api.current as SyncedPlayback;
  const setDuration = (next: number) => act(() => rerender(<Harness duration={next} />));
  return { p, step, setDuration };
}

describe('useSyncedPlayback', () => {
  it('plays each phone at its own time, and holds a late one at 0 until it joins', () => {
    const { p, step } = setup();
    const early = fakeVideo();
    const late = fakeVideo();
    act(() => {
      p().bind('a', { offsetMs: -1000, durationMs: 61_000 })(early);
      p().bind('b', { offsetMs: 10_000, durationMs: 20_000 })(late);
    });
    act(() => p().play());
    expect(early.currentTime).toBeCloseTo(1);
    expect(early.paused).toBe(false);
    expect(late.paused).toBe(true);
    step(5000);
    expect(late.paused).toBe(true);
    expect(late.currentTime).toBe(0);
    step(6000);
    expect(late.paused).toBe(false);
    expect(p().playing).toBe(true);
  });

  it('pulls back a video that drifted past 250 ms, and leaves a small drift alone', () => {
    const { p, step } = setup();
    const v = fakeVideo();
    act(() => p().bind('a', { offsetMs: 0, durationMs: 60_000 })(v));
    act(() => p().play());
    step(10_000);
    v.currentTime = 10.2; // 200 ms ahead of 10.0 s
    step(0);
    expect(v.currentTime).toBeCloseTo(10.2);
    v.currentTime = 11; // 1 s ahead
    step(0);
    expect(v.currentTime).toBeCloseTo(10);
  });

  it('waits for a stalled video, pausing the rest, then carries on from the same time', () => {
    const { p, step } = setup();
    const a = fakeVideo();
    const b = fakeVideo();
    act(() => {
      p().bind('a', { offsetMs: 0, durationMs: 60_000 })(a);
      p().bind('b', { offsetMs: 0, durationMs: 60_000 })(b);
    });
    act(() => p().play());
    step(2000);
    (b as any).readyState = 2;
    step(1000);
    expect(p().waiting).toBe(true);
    expect(a.paused).toBe(true);
    const held = p().timeMs;
    step(5000);
    expect(p().timeMs).toBe(held);
    (b as any).readyState = 4;
    step(0);
    step(1000);
    expect(p().waiting).toBe(false);
    expect(a.paused).toBe(false);
    expect(p().timeMs).toBeGreaterThan(held);
  });

  it('ignores a video that failed to load', () => {
    const { p, step } = setup();
    const ok = fakeVideo();
    const broken = fakeVideo({ readyState: 0, error: {} as MediaError });
    act(() => {
      p().bind('a', { offsetMs: 0, durationMs: 60_000 })(ok);
      p().bind('b', { offsetMs: 0, durationMs: 60_000 })(broken);
    });
    act(() => p().play());
    step(1000);
    expect(p().waiting).toBe(false);
    expect(broken.play).not.toHaveBeenCalled();
  });

  it('stops at the end, and plays again from the start', () => {
    const { p, step } = setup(10_000);
    const v = fakeVideo();
    act(() => p().bind('a', { offsetMs: 0, durationMs: 10_000 })(v));
    act(() => p().play());
    step(12_000);
    expect(p().playing).toBe(false);
    expect(p().timeMs).toBe(10_000);
    act(() => p().play());
    expect(p().timeMs).toBe(0);
    expect(p().playing).toBe(true);
  });

  it('keeps playing through a duration change until the new end, not the stale one', () => {
    const { p, step, setDuration } = setupRerenderable(10_000);
    const v = fakeVideo();
    act(() => p().bind('a', { offsetMs: 0, durationMs: 10_000 })(v));
    act(() => p().play());
    setDuration(20_000);
    step(10_000);
    expect(p().playing).toBe(true);
    expect(p().timeMs).toBe(10_000);
    step(10_000);
    expect(p().playing).toBe(false);
    expect(p().timeMs).toBe(20_000);
  });

  it('seeks every video while paused, clamped to the recording', () => {
    const { p } = setup(60_000);
    const a = fakeVideo();
    const b = fakeVideo();
    act(() => {
      p().bind('a', { offsetMs: 0, durationMs: 60_000 })(a);
      p().bind('b', { offsetMs: 20_000, durationMs: 30_000 })(b);
    });
    act(() => p().seek(30_000));
    expect(a.currentTime).toBeCloseTo(30);
    expect(b.currentTime).toBeCloseTo(10);
    expect(a.paused).toBe(true);
    act(() => p().seek(99_999));
    expect(p().timeMs).toBe(60_000);
    expect(b.currentTime).toBeCloseTo(30); // finished: held at its end
  });

  describe('a video whose file ends before its stored length', () => {
    // duration_ms can read ~40 ms longer than the file the browser plays: here
    // the file is 16.92 s and the stored length 16.96 s, so for 40 ms the group
    // clock says "playing" over a video that has already ended.
    function playedToItsEnd() {
      const { p, step } = setup(30_000);
      const short = fakeVideo({ duration: 16.92 } as Partial<HTMLVideoElement>);
      const long = fakeVideo();
      act(() => {
        p().bind('short', { offsetMs: 0, durationMs: 16_960 })(short);
        p().bind('long', { offsetMs: 0, durationMs: 30_000 })(long);
      });
      act(() => p().play());
      step(16_900);
      // The browser plays the last frames out and stops at the file's own end.
      Object.assign(short, { currentTime: 16.92, ended: true, paused: true });
      short.play.mockClear();
      return { p, step, short, long };
    }

    it('is not restarted while the group clock is still inside its stored length', () => {
      const { p, step, short, long } = playedToItsEnd();
      step(30); // group 16 930 ms: inside 16 960, past the file's 16 920
      expect(short.play).not.toHaveBeenCalled();
      expect(short.currentTime).toBeCloseTo(16.92);
      expect(long.paused).toBe(false);
      expect(p().playing).toBe(true);
    });

    it('does not make the others wait, even when it reports no future data', () => {
      const { p, step, short } = playedToItsEnd();
      // Chromium reports HAVE_ENOUGH_DATA at the end; other browsers HAVE_CURRENT_DATA.
      (short as any).readyState = 2;
      step(30);
      expect(p().waiting).toBe(false);
      step(1000);
      expect(p().waiting).toBe(false);
      expect(p().timeMs).toBeGreaterThan(17_000);
    });

    it('is not restarted by Play after a paused seek to just before its end', () => {
      const { p, short } = playedToItsEnd();
      act(() => p().pause());
      act(() => p().seek(16_930));
      act(() => p().play());
      expect(short.play).not.toHaveBeenCalled();
      expect(short.currentTime).toBeCloseTo(16.92);
    });

    it('plays again after a seek back into it', () => {
      const { p, short } = playedToItsEnd();
      act(() => p().pause());
      act(() => p().seek(5000));
      expect(short.currentTime).toBeCloseTo(5);
      expect(short.ended).toBe(false);
      act(() => p().play());
      expect(short.play).toHaveBeenCalled();
      expect(short.currentTime).toBeCloseTo(5);
    });
  });

  it('lands a paused seek exactly, not just within the 250 ms playing tolerance', () => {
    const { p } = setup(60_000);
    const v = fakeVideo();
    act(() => p().bind('a', { offsetMs: 0, durationMs: 60_000 })(v));
    act(() => p().seek(10_000));
    expect(v.currentTime).toBeCloseTo(10);
    act(() => p().seek(10_100)); // 100 ms on: under 250, over one frame
    expect(v.currentTime).toBeCloseTo(10.1);
    act(() => p().seek(10_110)); // within one frame (20 ms): left alone
    expect(v.currentTime).toBeCloseTo(10.1);
  });

  it('gives the same ref callback for the same phone', () => {
    const { p } = setup();
    expect(p().bind('a', { offsetMs: 0, durationMs: 1 })).toBe(
      p().bind('a', { offsetMs: 0, durationMs: 1 }),
    );
  });
});
