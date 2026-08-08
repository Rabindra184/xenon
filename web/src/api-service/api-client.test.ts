import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient, { setApiToastEmitter } from './api-client';

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
