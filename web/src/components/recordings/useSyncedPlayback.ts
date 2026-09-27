import { useCallback, useEffect, useRef, useState } from 'react';
import { clampTime, needsResync, tilePhase, videoTimeMs } from './playback';

export interface SyncTarget {
  offsetMs: number;
  durationMs: number | null;
}

export interface PlaybackClock {
  now(): number;
  schedule(cb: () => void): number;
  cancel(id: number): void;
}

export interface SyncedPlayback {
  timeMs: number;
  playing: boolean;
  waiting: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
  bind(id: string, target: SyncTarget): (el: HTMLVideoElement | null) => void;
}

const browserClock: PlaybackClock = {
  now: () => performance.now(),
  schedule: (cb) => window.requestAnimationFrame(() => cb()),
  cancel: (id) => window.cancelAnimationFrame(id),
};

/** The transport re-renders this often while playing, not every frame. */
const RENDER_EVERY_MS = 100;
const HAVE_FUTURE_DATA = 3;

/**
 * One clock for every phone's <video>. The clock is the truth; videos follow
 * it (each at its own offset), are corrected when they drift, and a video
 * that stalls holds the clock so the phones never fall out of step.
 */
export function useSyncedPlayback(
  durationMs: number,
  clock: PlaybackClock = browserClock,
): SyncedPlayback {
  const els = useRef(new Map<string, HTMLVideoElement>());
  const targets = useRef(new Map<string, SyncTarget>());
  const refs = useRef(new Map<string, (el: HTMLVideoElement | null) => void>());
  // since: clock time the group time last started advancing; null while held.
  const s = useRef({ baseMs: 0, since: null as number | null, running: false, waiting: false });
  const frame = useRef<number | null>(null);
  const lastRender = useRef(-Infinity);
  const [view, setView] = useState({ timeMs: 0, playing: false, waiting: false });

  const current = () =>
    s.current.since === null
      ? s.current.baseMs
      : s.current.baseMs + (clock.now() - s.current.since);

  const drive = (t: number, advancing: boolean) => {
    els.current.forEach((el, id) => {
      const target = targets.current.get(id);
      if (!target || el.error) return;
      const phase = tilePhase(t, target.offsetMs, target.durationMs);
      const wantMs =
        phase === 'before'
          ? 0
          : phase === 'after'
            ? (target.durationMs as number)
            : videoTimeMs(t, target.offsetMs);
      if (needsResync(el.currentTime * 1000, wantMs)) el.currentTime = wantMs / 1000;
      if (advancing && phase === 'playing') {
        if (el.paused) el.play()?.catch(() => undefined);
      } else if (!el.paused) {
        el.pause();
      }
    });
  };

  const stalledAt = (t: number) => {
    let stalled = false;
    els.current.forEach((el, id) => {
      if (stalled) return;
      const target = targets.current.get(id);
      if (
        target &&
        !el.error &&
        tilePhase(t, target.offsetMs, target.durationMs) === 'playing' &&
        el.readyState < HAVE_FUTURE_DATA
      ) {
        stalled = true;
      }
    });
    return stalled;
  };

  const render = (force: boolean) => {
    const now = clock.now();
    if (!force && now - lastRender.current < RENDER_EVERY_MS) return;
    lastRender.current = now;
    setView({ timeMs: current(), playing: s.current.running, waiting: s.current.waiting });
  };

  const stopFrames = () => {
    if (frame.current !== null) clock.cancel(frame.current);
    frame.current = null;
  };

  const tick = () => {
    frame.current = null;
    const st = s.current;
    if (!st.running) return;
    const t = current();
    if (t >= durationMs) {
      Object.assign(st, { baseMs: durationMs, since: null, running: false, waiting: false });
      drive(durationMs, false);
      render(true);
      return;
    }
    const stalled = stalledAt(t);
    if (stalled !== st.waiting) {
      st.baseMs = t;
      st.since = stalled ? null : clock.now();
      st.waiting = stalled;
      drive(t, !stalled);
      render(true);
    } else {
      drive(t, !stalled);
      render(false);
    }
    frame.current = clock.schedule(tick);
  };

  const play = () => {
    const st = s.current;
    if (current() >= durationMs) st.baseMs = 0;
    else st.baseMs = current();
    Object.assign(st, { since: clock.now(), running: true, waiting: false });
    drive(st.baseMs, true);
    render(true);
    stopFrames();
    frame.current = clock.schedule(tick);
  };

  const pause = () => {
    const st = s.current;
    Object.assign(st, { baseMs: current(), since: null, running: false, waiting: false });
    stopFrames();
    drive(st.baseMs, false);
    render(true);
  };

  const seek = (ms: number) => {
    const st = s.current;
    const t = clampTime(ms, durationMs);
    st.baseMs = t;
    st.since = st.running && !st.waiting ? clock.now() : null;
    drive(t, st.running && !st.waiting);
    render(true);
  };

  const bind = useCallback((id: string, target: SyncTarget) => {
    targets.current.set(id, target);
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (el: HTMLVideoElement | null) => {
        if (el) {
          els.current.set(id, el);
          const st = s.current;
          drive(current(), st.running && !st.waiting);
        } else {
          els.current.delete(id);
        }
      };
      refs.current.set(id, ref);
    }
    return ref;
    // drive/current read refs only.
  }, []);

  useEffect(() => stopFrames, []);

  return {
    ...view,
    play,
    pause,
    toggle: () => (s.current.running ? pause() : play()),
    seek,
    bind,
  };
}
