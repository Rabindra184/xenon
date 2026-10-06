// Quit sequencing for the supervised Xenon child, kept free of Electron so the
// decisions are unit-testable. ⌘Q must not cut Xenon's shutdown drain short:
// the first quit asks Xenon to stop and waits, a second quit forces it.
import { STOP_GRACE_MS, STOP_TERM_GRACE_MS } from './stopEscalation';

export type QuitDecision = 'quit' | 'stop-then-quit' | 'wait' | 'force-then-quit';

export interface QuitState {
  /** A server child is starting, running or stopping. */
  serverActive: boolean;
  /** The server's status is already 'stopping' (a Stop was pressed). */
  stopping: boolean;
  /** A quit has already been deferred once (this is a repeat ⌘Q). */
  quitPending: boolean;
}

export function decideQuit(s: QuitState): QuitDecision {
  if (!s.serverActive) return 'quit';
  if (s.quitPending) return 'force-then-quit';
  return s.stopping ? 'wait' : 'stop-then-quit';
}

/** Outer limit on the quit wait: the whole SIGINT, SIGTERM, SIGKILL ladder plus slack. */
export const QUIT_WAIT_CAP_MS = STOP_GRACE_MS + STOP_TERM_GRACE_MS + 2000;

/** Resolves with `p`'s value, or 'timeout' if it has not settled within `ms`. */
export function withCap<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
