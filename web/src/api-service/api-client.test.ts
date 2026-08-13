import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient, { isDeviceConflictBody, setApiToastEmitter } from './api-client';

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
