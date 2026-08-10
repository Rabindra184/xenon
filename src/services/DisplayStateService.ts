import { Service } from 'typedi';
import log from '../logger';
import { DisplayState } from '../device-managers/android/displayState';

/**
 * How long a reading stays good enough to hand to another caller. Short
 * enough that waking a device is reflected almost immediately, long enough
 * that a mosaic of tiles all watching the same device is still one adb call.
 */
export const DISPLAY_STATE_TTL_MS = 2000;

type Reader = () => Promise<DisplayState>;

interface Entry {
  state: DisplayState;
  readAt: number;
  inflight?: Promise<DisplayState>;
}

/**
 * A tiny read-through cache in front of `dumpsys power`.
 *
 * This is polled by every open preview, so it has two jobs beyond caching:
 * collapse concurrent callers onto one adb call, and never throw. A display
 * hint that raises is worse than no hint at all — the caller would have to
 * defend against it on a path whose whole purpose is being unobtrusive.
 */
@Service()
export class DisplayStateService {
  private cache = new Map<string, Entry>();
  private log = log.scope('DisplayState');

  async get(udid: string, read: Reader, now: number = Date.now()): Promise<DisplayState> {
    const cached = this.cache.get(udid);

    if (cached && now - cached.readAt < DISPLAY_STATE_TTL_MS) return cached.state;
    // A second caller arriving mid-read waits for the first one's answer
    // rather than spawning its own adb.
    if (cached?.inflight) return cached.inflight;

    const inflight = Promise.resolve()
      .then(read)
      .then((state) => {
        this.cache.set(udid, { state, readAt: Date.now() });
        return state;
      })
      .catch((err: any) => {
        // Drop the entry rather than caching the failure: the next caller
        // should retry, not inherit a stale 'unknown' for the TTL.
        this.cache.delete(udid);
        this.log.warn(`Display state read failed for ${udid}: ${err.message}`);
        return 'unknown' as DisplayState;
      });

    // `read` may throw synchronously; Promise.resolve().then defers it into
    // the chain above so the entry is always consistent with the promise.
    this.cache.set(udid, {
      state: cached?.state ?? 'unknown',
      readAt: cached?.readAt ?? 0,
      inflight,
    });
    return inflight;
  }

  forget(udid: string): void {
    this.cache.delete(udid);
  }
}
