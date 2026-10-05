// Module-level toast emitter. The api-client is a plain (non-React) module,
// but it needs to surface a 'forbidden' toast on 403 so a Member who hits
// an admin-only route gets immediate feedback instead of a silent failure.
//
// The ToastProvider (web/src/components/ui/toast.tsx) registers its
// `toast(...)` callback here on mount via `setApiToastEmitter`, and the
// api-client invokes it from `parseResponse` when a 403 comes back.
type ToastFn = (message: string, type?: 'success' | 'error' | 'info' | 'loading') => void;
let toastEmitter: ToastFn | null = null;

export function setApiToastEmitter(fn: ToastFn | null): void {
  toastEmitter = fn;
}

const DEVICE_CONFLICT_CODES = new Set(['device_held_by_another_user', 'device_in_use_by_session']);

// A hub's refusals for a node's or a cloud provider's phone, for an action it
// doesn't pass on (src/app/routers/nodePhoneControl.ts).
const REMOTE_PHONE_REFUSALS = new Set([
  'not_available_through_hub',
  'not_available_for_cloud_phone',
]);

// A preview the server refuses with a reason for the tester: an iOS simulator
// shows its running test's picture, and none runs.
const PREVIEW_REFUSALS = new Set(['simulator_needs_test']);

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
// gestures, a keystroke run is one call per character), and so does a phone
// the hub can't run an action on. Show each distinct message at most once per
// interval so the toast stack stays readable.
const CONFLICT_TOAST_INTERVAL_MS = 5000;
const lastConflictToastAt = new Map<string, number>();

/** True when the message is on screen: toasted now, or within the interval. */
function notifyThrottled(message: string): boolean {
  if (!toastEmitter) return false;
  const now = Date.now();
  const last = lastConflictToastAt.get(message) ?? 0;
  if (now - last < CONFLICT_TOAST_INTERVAL_MS) return true;
  lastConflictToastAt.set(message, now);
  toastEmitter(message, 'error');
  return true;
}

/**
 * A request that reached the server and was refused (non-2xx). Carries the
 * status and the parsed body so a caller can show the server's own reason.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    /** The api-client already showed this refusal in a toast. */
    readonly shown = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Whether the api-client already toasted this failure (a 403, a device held by
 * someone else, an action a hub can't run), so a caller reporting its own
 * failure doesn't show the same one twice.
 */
export function alreadyShown(err: unknown): boolean {
  return err instanceof ApiError && err.shown;
}

/**
 * The sentence to show for an error body. A refusal named by a code
 * (`not_reservation_holder`, `internal`) carries its sentence in `message`;
 * one whose `error` is already a sentence keeps it, since `message` is then
 * often the technical detail.
 */
function reasonOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const { error, message } = body as { error?: unknown; message?: unknown };
  const isCode = typeof error !== 'string' || /^[a-z][a-z0-9_]*$/.test(error);
  if (isCode && typeof message === 'string' && message) return message;
  if (typeof error === 'string' && error) return error;
  return typeof message === 'string' && message ? message : undefined;
}

export interface RequestBehaviour {
  /**
   * Resolve with the error body instead of rejecting on a non-2xx response.
   * Only for callers that read `success`/`error` off the result themselves
   * (install, reserve, shell, AI test, stream start's 409 rollback). Everything
   * else must let the failure reject, or a refused save reads as a success.
   */
  resolveErrors?: boolean;
}

async function parseResponse(res: Response, rejectErrors: boolean): Promise<any> {
  let shown = false;
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => ({}) as any);
    const msg = reasonOf(body) || 'You do not have permission for this action.';
    if (toastEmitter) {
      toastEmitter(msg, 'error');
      shown = true;
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
      shown = notifyThrottled(body.message || 'This device is in use by another user.');
    } else if (PREVIEW_REFUSALS.has(body?.error) && body.message) {
      shown = notifyThrottled(body.message);
    }
  }
  // 501 from /control on a hub: the phone is another server's and the hub
  // doesn't pass this action on yet. Without the reason a refused preview
  // just stays blank.
  if (res.status === 501) {
    const body = await res
      .clone()
      .json()
      .catch(() => ({}) as any);
    if (REMOTE_PHONE_REFUSALS.has(body?.error) && body.message) {
      shown = notifyThrottled(body.message);
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

  // Before this, every status resolved with its body, so a 400/500 from a
  // save was indistinguishable from success: Settings toasted "synchronized
  // across fleet" and marked the form clean while the server had refused it.
  if (rejectErrors && (res.status < 200 || res.status >= 300)) {
    const body = await res.json().catch(() => null);
    const reason = reasonOf(body) || `Request failed (${res.status})`;
    throw new ApiError(reason, res.status, body, shown);
  }
  return res.json();
}

class ApiClient {
  // GETs still resolve with error bodies: loaders across the app read them,
  // and making reads reject belongs with giving every page an error state.
  // Mutations reject by default — see RequestBehaviour.
  public makeGETRequest(url: string) {
    return fetch(this.formatUrl(url)).then((res) => parseResponse(res, false));
  }

  public makePOSTRequest(
    url: string,
    queryParams: any,
    body: any,
    options: RequestInit = {},
    behaviour: RequestBehaviour = {},
  ) {
    return fetch(this.formatUrl(url), {
      method: 'POST',
      body: JSON.stringify(body || {}),
      headers: { 'Content-Type': 'application/json' },
      ...options,
    }).then((res) => parseResponse(res, !behaviour.resolveErrors));
  }

  public makeDELETERequest(url: string, behaviour: RequestBehaviour = {}) {
    return fetch(this.formatUrl(url), {
      method: 'DELETE',
    }).then((res) => parseResponse(res, !behaviour.resolveErrors));
  }

  public formatUrl(url: string) {
    return `/xenon/api${url}`;
  }
}

export default new ApiClient();

/**
 * A save failure a person can act on: the server's own reason when it
 * refused, and "couldn't reach" only when the request never got an answer.
 */
export function describeSaveError(err: unknown): string {
  if (err instanceof ApiError) return `The server rejected the change: ${err.message}`;
  return "Couldn't reach the Xenon server. Check your connection and try again.";
}

/** Shows why a save failed, unless the api-client already showed it. */
export function toastSaveError(toast: ToastFn, err: unknown): void {
  if (!alreadyShown(err)) toast(describeSaveError(err), 'error');
}
