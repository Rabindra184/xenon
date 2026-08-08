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
      if (body && DEVICE_CONFLICT_CODES.has(body.error)) {
        notifyDeviceConflict(body.message || 'This device is in use by another user.');
      }
    }
    return res.json();
  }
}

export default new ApiClient();
