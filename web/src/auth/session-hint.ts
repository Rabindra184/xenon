/**
 * Remembers, per browser, that this user was signed in — so that landing on
 * the sign-in page without a session can be explained as "your session
 * expired" rather than looking like a fresh visit. Cleared on a deliberate
 * sign-out, so signing out never reads as an expiry.
 *
 * A hint, not a security control: storage may be blocked (private windows,
 * locked-down browsers), in which case the page simply shows no notice.
 */
const KEY = 'xenon.hadSession';

export function markSignedIn(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage unavailable — no hint */
  }
}

export function clearSessionHint(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Whether this browser had a session. Read-only, so it is safe to call during
 * render; the sign-in page clears the hint once it has shown the notice.
 */
export function hadSession(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
