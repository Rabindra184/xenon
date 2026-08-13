// Module-level toast emitter. The api-client is a plain (non-React) module,
// but it needs to surface a 'forbidden' toast on 403 so a Member who hits
// an admin-only route gets immediate feedback instead of a silent failure.
//
// The ToastProvider (web/src/components/ui/toast.tsx) registers its
// `toast(...)` callback here on mount via `setApiToastEmitter`, and the
// api-client invokes it from `jsonResult` when a 403 comes back.
type ToastFn = (message: string, type?: 'success' | 'error' | 'info' | 'loading') => void;
let toastEmitter: ToastFn | null = null;

export function setApiToastEmitter(fn: ToastFn | null): void {
  toastEmitter = fn;
}

const DEVICE_CONFLICT_CODES = new Set(['device_held_by_another_user', 'device_in_use_by_session']);

/**
 * True when a response body says the device is held by someone else.
 *
 * Callers that optimistically show state before the request lands (the mosaic
 * adds a tile, then fires stream/start) use this to decide whether to roll
 * that state back. It is deliberately narrow: a plain network failure or a
 * retryable `device_ownership_unavailable` must NOT roll back, because
 * GET /stream auto-starts the underlying service and the tile recovers on its
 * own. Only a genuine ownership conflict is unrecoverable without user action.
 */
export function isDeviceConflictBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return DEVICE_CONFLICT_CODES.has((body as { error?: string }).error ?? '');
}

// A held device usually produces a burst of denials (a swipe is several
// gestures, a keystroke run is one call per character). Show each distinct
// message at most once per interval so the toast stack stays readable.
const CONFLICT_TOAST_INTERVAL_MS = 5000;
const lastConflictToastAt = new Map<string, number>();

function notifyDeviceConflict(message: string): void {
  if (!toastEmitter) return;
  const now = Date.now();
  const last = lastConflictToastAt.get(message) ?? 0;
  if (now - last < CONFLICT_TOAST_INTERVAL_MS) return;
  lastConflictToastAt.set(message, now);
  toastEmitter(message, 'error');
}

class ApiClient {
  public makeGETRequest(url: string) {
    return fetch(this.formatUrl(url)).then(this.jsonResult);
  }

  public makePOSTRequest(url: string, queryParams: any, body: any, options: RequestInit = {}) {
    return fetch(this.formatUrl(url), {
      method: 'POST',
      body: JSON.stringify(body || {}),
      headers: { 'Content-Type': 'application/json' },
      ...options,
    }).then(this.jsonResult);
  }

  public makeDELETERequest(url: string) {
    return fetch(this.formatUrl(url), {
      method: 'DELETE',
    }).then(this.jsonResult);
  }

  public formatUrl(url: string) {
    return `/xenon/api${url}`;
  }

  private async jsonResult(res: Response) {
    if (res.status === 403) {
      const body = await res.clone().json().catch(() => ({}) as any);
      const msg =
        (body && (body.error || body.message)) ||
        'You do not have permission for this action.';
      if (toastEmitter) {
        toastEmitter(msg, 'error');
      }
    }
    // 409 from /control means another user (or their Appium session) holds the
    // device. Without this a blocked tap is a silent no-op — the user sees a
    // frozen tile and assumes the stream broke.
    if (res.status === 409) {
      const body = await res
        .clone()
        .json()
        .catch(() => ({}) as any);
      if (isDeviceConflictBody(body)) {
        notifyDeviceConflict(body.message || 'This device is in use by another user.');
      }
    }
    // 204 and 205 carry no body by definition, and `res.json()` throws
    // `Unexpected end of JSON input` on an empty one.
    //
    // Deleting an app hit exactly this. `DELETE /apps/:id` answers
    // `sendStatus(204)`, so the request succeeded — the row really was gone
    // from the server — but the parse threw on the way back, the caller's
    // catch swallowed it into a console error, and the row stayed on screen.
    // The artifact looked undeletable, and clicking again re-asked
    // "Permanently remove …?" about something that no longer existed.
    if (res.status === 204 || res.status === 205) return null;
    return res.json();
  }
}

export default new ApiClient();
