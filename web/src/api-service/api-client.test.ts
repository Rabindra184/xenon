import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient, {
  ApiError,
  alreadyShown,
  describeSaveError,
  isDeviceConflictBody,
  setApiToastEmitter,
  toastSaveError,
} from './api-client';

// Minimal stand-in for the fetch Response the api-client actually consumes:
// `jsonResult` calls `res.clone().json()` to peek at the body on 403/409,
// then unconditionally calls `res.json()` again to return the real payload.
// A real Response only lets you read the body once (hence `.clone()`), but a
// plain object with a repeatable `json()` doesn't need that guard — `clone()`
// just returns `this`.
function mockResponse(status: number, body: unknown) {
  return {
    status,
    clone() {
      return this;
    },
    json: async () => body,
  };
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(status, body)));
}

describe('api-client device-conflict toast', () => {
  let toast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = vi.fn();
    setApiToastEmitter(toast);
  });

  afterEach(() => {
    setApiToastEmitter(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fires the toast on a 409 with a device-conflict error code', async () => {
    const message = 'Device is being controlled by alice@example.com (case: fires).';
    stubFetch(409, {
      success: false,
      error: 'device_held_by_another_user',
      message,
    });

    await apiClient.makeGETRequest('/control/some-udid/tap');

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(message, 'error');
  });

  it('suppresses an identical message seen again inside the 5s window', async () => {
    const message = 'Device is being controlled by bob@example.com (case: suppressed).';
    stubFetch(409, { success: false, error: 'device_in_use_by_session', message });

    await apiClient.makeGETRequest('/control/some-udid/tap');
    vi.setSystemTime(Date.now() + 4999);
    await apiClient.makeGETRequest('/control/some-udid/tap');

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('fires again for the same message once the 5s window has elapsed', async () => {
    const message = 'Device is being controlled by carol@example.com (case: window elapsed).';
    stubFetch(409, { success: false, error: 'device_held_by_another_user', message });

    await apiClient.makeGETRequest('/control/some-udid/tap');
    vi.setSystemTime(Date.now() + 5000);
    await apiClient.makeGETRequest('/control/some-udid/tap');

    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('does not fire for a 409 whose error code is not a device conflict', async () => {
    stubFetch(409, {
      success: false,
      error: 'some_other_conflict',
      message: 'unrelated conflict',
    });

    await apiClient.makeGETRequest('/control/some-udid/tap');

    expect(toast).not.toHaveBeenCalled();
  });

  // A hub refuses, for a node's or a cloud provider's phone, what it doesn't
  // pass on yet (live preview first of all). Without a toast the preview just
  // stays blank.
  it('toasts the server’s reason for an action a hub can’t run on a remote phone', async () => {
    const message =
      "This phone is on node http://10.0.0.9:4725, and the hub doesn't pass stream/start on to nodes yet.";
    stubFetch(501, { success: false, error: 'not_available_through_hub', message });

    const start = () =>
      apiClient.makePOSTRequest(
        '/control/some-udid/stream/start',
        {},
        {},
        {},
        { resolveErrors: true },
      );
    await start();
    await start();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(message, 'error');

    stubFetch(501, {
      success: false,
      error: 'not_available_for_cloud_phone',
      message: "This phone is a cloud provider's. Device control isn't available for it here.",
    });
    await apiClient.makeGETRequest('/control/cloud-udid/screenshot');
    expect(toast).toHaveBeenCalledTimes(2);
  });

  // A simulator shows its running test's picture: with none running, the
  // preview is refused, and the reason is the only thing to show.
  it('toasts why a simulator with no test running shows no preview', async () => {
    const message = "A simulator's screen shows here only while a test runs on it.";
    stubFetch(409, { success: false, error: 'simulator_needs_test', message });

    await apiClient.makePOSTRequest(
      '/control/sim-udid/stream/start',
      {},
      {},
      {},
      { resolveErrors: true },
    );

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(message, 'error');
  });

  it('does not toast a 501 that isn’t one of those refusals', async () => {
    stubFetch(501, { error: 'The clipboard on Android is read-only.' });

    await apiClient.makeGETRequest('/control/some-udid/clipboard');

    expect(toast).not.toHaveBeenCalled();
  });

  it('still toasts on 403 as before (no regression)', async () => {
    stubFetch(403, { error: 'forbidden' });

    await apiClient.makeGETRequest('/some/admin/route');

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('forbidden', 'error');
  });
});

// The mosaic optimistically adds a tile, then fires stream/start. When the
// device turns out to be held by someone else, the tile must be rolled back —
// otherwise it sits on "Starting Stream…" forever. But a rollback on ANY
// failure would be a regression: a network blip is survivable because
// GET /stream auto-starts the underlying service, so the tile should stay.
// Hence a predicate that is true for device conflicts and nothing else.
describe('isDeviceConflictBody', () => {
  it('is true for a lock held by another user', () => {
    expect(isDeviceConflictBody({ success: false, error: 'device_held_by_another_user' })).toBe(
      true,
    );
  });

  it('is true for a device busy with another user\'s Appium session', () => {
    expect(isDeviceConflictBody({ success: false, error: 'device_in_use_by_session' })).toBe(true);
  });

  it('is false for a successful stream start', () => {
    expect(isDeviceConflictBody({ success: true, type: 'mjpeg', mjpegPort: 9100 })).toBe(false);
  });

  it('is false when ownership could not be verified (503) — that is retryable, not a conflict', () => {
    expect(isDeviceConflictBody({ success: false, error: 'device_ownership_unavailable' })).toBe(
      false,
    );
  });

  it('is false for an unrelated error body', () => {
    expect(isDeviceConflictBody({ success: false, error: 'some_other_conflict' })).toBe(false);
  });

  it('is false for null/undefined — a rejected fetch must not roll the tile back', () => {
    expect(isDeviceConflictBody(null)).toBe(false);
    expect(isDeviceConflictBody(undefined)).toBe(false);
  });

  it('is false for a non-object body', () => {
    expect(isDeviceConflictBody('device_held_by_another_user')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bodiless responses. `jsonResult` used to end in an unconditional
// `res.json()`, which throws on a 204 — see the comment there.
// ---------------------------------------------------------------------------
describe('api-client responses with no body', () => {
  /** A 204 the way the platform builds it: reading it as JSON throws. */
  function emptyResponse(status: number) {
    return {
      status,
      clone() {
        return this;
      },
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The bug this exists for: DELETE /apps/:id answers 204, the delete really
  // happened, but the parse threw on the way back — so the caller's catch
  // swallowed it and the row stayed on screen looking undeletable.
  it('resolves instead of throwing on a 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyResponse(204)));
    expect(await apiClient.makeDELETERequest('/apps/abc')).to.equal(null);
  });

  it('resolves on a 205 too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyResponse(205)));
    expect(await apiClient.makeDELETERequest('/apps/abc')).to.equal(null);
  });

  // Still parses a real body — the fix must not swallow every response.
  it('parses a 200 body as before', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        clone() {
          return this;
        },
        json: async () => ({ ok: true }),
      }),
    );
    expect(await apiClient.makeDELETERequest('/apps/abc')).to.deep.equal({ ok: true });
  });
});

describe('api-client: mutations reject on a refused request', () => {
  afterEach(() => {
    setApiToastEmitter(null);
    vi.unstubAllGlobals();
  });

  it('a POST answered 400 rejects with the server reason, not a resolved body', async () => {
    stubFetch(400, { error: 'interval below minimum' });
    await expect(apiClient.makePOSTRequest('/config', {}, {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'interval below minimum',
    });
  });

  it('a DELETE answered 500 rejects, falling back to the status when there is no reason', async () => {
    stubFetch(500, {});
    await expect(apiClient.makeDELETERequest('/apps/x')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (500)',
    });
  });

  it('a 403 still toasts, and now also rejects so the caller cannot report success', async () => {
    const toast = vi.fn();
    setApiToastEmitter(toast);
    stubFetch(403, { error: 'admin scope required' });
    await expect(apiClient.makePOSTRequest('/config', {}, {})).rejects.toBeInstanceOf(ApiError);
    expect(toast).toHaveBeenCalledWith('admin scope required', 'error');
  });

  // A refusal named by a code carries its sentence in `message`. Showing the
  // code put "not_reservation_holder" on screen for a member who tried to
  // release someone else's reservation.
  it('shows the message, not the code, when the error is only a code', async () => {
    const toast = vi.fn();
    setApiToastEmitter(toast);
    const message =
      'Only the person who reserved this device, or an admin, can change the reservation.';
    stubFetch(403, { success: false, error: 'not_reservation_holder', message });
    await expect(apiClient.makeDELETERequest('/reservation/u/h')).rejects.toMatchObject({
      message,
    });
    expect(toast).toHaveBeenCalledWith(message, 'error');
  });

  it('shows the message when the error is not text at all', async () => {
    stubFetch(500, { error: true, message: 'config store unavailable' });
    await expect(apiClient.makePOSTRequest('/config', {}, {})).rejects.toMatchObject({
      message: 'config store unavailable',
    });
  });

  it('keeps an error that is already a sentence over a technical message', async () => {
    stubFetch(503, { error: 'Android stream failed', message: 'spawn adb ENOENT' });
    await expect(
      apiClient.makePOSTRequest('/control/u/stream/start', {}, {}),
    ).rejects.toMatchObject({ message: 'Android stream failed' });
  });

  // So a caller that reports its own failure doesn't show the same one twice.
  it('marks a refusal it already showed', async () => {
    setApiToastEmitter(vi.fn());
    stubFetch(403, { error: 'Only a super admin can change the lab’s settings.' });
    const shown = await apiClient.makePOSTRequest('/config', {}, {}).catch((e) => e);
    expect(alreadyShown(shown)).toBe(true);

    stubFetch(409, { error: 'device_held_by_another_user', message: 'held by Ada (marks)' });
    const conflict = await apiClient.makePOSTRequest('/control/u/tap', {}, {}).catch((e) => e);
    expect(alreadyShown(conflict)).toBe(true);

    stubFetch(500, { error: 'connect ECONNREFUSED' });
    const failed = await apiClient.makePOSTRequest('/control/u/lock', {}, {}).catch((e) => e);
    expect(alreadyShown(failed)).toBe(false);
    expect(alreadyShown(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('resolveErrors keeps the old contract for callers that read the body', async () => {
    stubFetch(409, { success: false, error: 'device_held_by_another_user', message: 'held' });
    await expect(
      apiClient.makePOSTRequest('/control/u/stream/start', {}, {}, {}, { resolveErrors: true }),
    ).resolves.toMatchObject({ error: 'device_held_by_another_user' });
  });

  it('GETs still resolve with error bodies (loaders read them; changing that is separate work)', async () => {
    stubFetch(404, { error: 'not found' });
    await expect(apiClient.makeGETRequest('/builds/x')).resolves.toEqual({ error: 'not found' });
  });

  it('2xx and 204 are unchanged', async () => {
    stubFetch(200, { ok: 1 });
    await expect(apiClient.makePOSTRequest('/config', {}, {})).resolves.toEqual({ ok: 1 });
    stubFetch(204, undefined);
    await expect(apiClient.makeDELETERequest('/apps/x')).resolves.toBeNull();
  });
});

describe('describeSaveError', () => {
  it('shows the server reason for a refusal and blames the network only for a network failure', () => {
    expect(describeSaveError(new ApiError('interval below minimum', 400, {}))).toBe(
      'The server rejected the change: interval below minimum',
    );
    expect(describeSaveError(new TypeError('Failed to fetch'))).toMatch(/Couldn't reach/);
  });
});

describe('toastSaveError', () => {
  // An admin saving Settings got "Only a super admin can change the lab's
  // settings." twice: once from the api-client's 403 toast, once from the page.
  it('shows a refusal the api-client already showed only once', () => {
    const toast = vi.fn();
    toastSaveError(
      toast,
      new ApiError('Only a super admin can change the lab’s settings.', 403, {}, true),
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows any other failure with its reason', () => {
    const toast = vi.fn();
    toastSaveError(toast, new ApiError('interval below minimum', 400, {}));
    toastSaveError(toast, new TypeError('Failed to fetch'));
    expect(toast).toHaveBeenNthCalledWith(
      1,
      'The server rejected the change: interval below minimum',
      'error',
    );
    expect(toast.mock.calls[1][0]).toMatch(/Couldn't reach/);
  });
});
