import { LoginError } from '../api-service/auth';

export type LoginProblem = {
  message: string;
  /** Set for a rate-limited attempt: seconds before signing in is allowed again. */
  retryAfterSec?: number;
};

/**
 * Turns a failed sign-in into a sentence a person can act on. The server's
 * own strings ("invalid credentials", "too many login attempts") are terse
 * lowercase API errors and were shown verbatim.
 *
 * A 401 deliberately does not distinguish a wrong password from a disabled
 * account — the server returns the same body for both so the form cannot be
 * used to probe which accounts exist, and the copy must not undo that.
 */
export function describeLoginError(err: unknown): LoginProblem {
  if (!(err instanceof LoginError)) {
    return { message: 'Sign-in failed. Try again.' };
  }
  switch (true) {
    case err.status === 0:
      return { message: "Can't reach the Xenon server. Check your connection and try again." };
    case err.status === 400:
      return { message: 'Enter your email and password.' };
    case err.status === 401:
      return { message: 'Incorrect email or password.' };
    case err.status === 429:
      return {
        message: 'Too many sign-in attempts.',
        // The limiter always sends Retry-After; fall back to its 5-min window.
        retryAfterSec: err.retryAfterSec ?? 300,
      };
    case err.status >= 500:
      return { message: 'Sign-in is unavailable right now. Try again in a moment.' };
    default:
      return { message: `Sign-in failed (${err.status}). Try again.` };
  }
}

/** "42s" under a minute, "4:05" from a minute up. */
export function formatWait(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
