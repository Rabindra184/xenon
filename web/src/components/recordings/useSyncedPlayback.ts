import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampTime,
  needsResync,
  PAUSED_RESYNC_MS,
  RESYNC_MS,
  tilePhase,
  videoTimeMs,
} from './playback';

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
/** This close to the end of its own file, a video counts as finished. */
const END_SLACK_S = 0.05;

/**
 * The video has played out its own file. The stored duration_ms can run ~40 ms
 * past the length the browser reads, so the group clock may still say
 * "playing" over a video that has ended — and play() on an ended video
 * rewinds it to 0. A finished video is held at its end, never played, and
 * never waited for: it has nothing left to buffer.
 */
function finished(el: HTMLVideoElement): boolean {
  return el.ended || (Number.isFinite(el.duration) && el.currentTime >= el.duration - END_SLACK_S);
}

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
  // durationMs can change between the render that scheduled a pending tick and the
  // tick itself firing; keep the live value in a ref like every other run-spanning
  // piece of state here, so tick/play/seek never act on a stale duration.
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
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
      let wantMs =
        phase === 'before'
          ? 0
          : phase === 'after'
            ? (target.durationMs as number)
            : videoTimeMs(t, target.offsetMs);
      // Never past the file's own end, which can come before the stored one.
      if (Number.isFinite(el.duration)) wantMs = Math.min(wantMs, el.duration * 1000);
      // Playing, small drift is left alone; paused, a seek lands exactly.
      const tolerance = advancing ? RESYNC_MS : PAUSED_RESYNC_MS;
      if (needsResync(el.currentTime * 1000, wantMs, tolerance)) el.currentTime = wantMs / 1000;
      if (advancing && phase === 'playing') {
        if (el.paused && !finished(el)) el.play()?.catch(() => undefined);
      } else if (!el.paused) {
        el.pause();
      }
    });
  };

  const stalledAt = (t: number) =>
    Array.from(els.current.entries()).some(([id, el]) => {
      const target = targets.current.get(id);
      return (
        !!target &&
        !el.error &&
        !finished(el) &&
        tilePhase(t, target.offsetMs, target.durationMs) === 'playing' &&
        el.readyState < HAVE_FUTURE_DATA
      );
    });

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
    if (t >= durationRef.current) {
      Object.assign(st, {
        baseMs: durationRef.current,
        since: null,
        running: false,
        waiting: false,
      });
      drive(durationRef.current, false);
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
    if (current() >= durationRef.current) st.baseMs = 0;
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
    const t = clampTime(ms, durationRef.current);
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
