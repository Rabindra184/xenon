import * as React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  logout: vi.fn(async () => undefined),
  clear: vi.fn(async () => undefined),
}));
vi.mock('../api-service/auth', () => ({
  getMe: vi.fn(async () => ({ userId: 'u1' })),
  logout: calls.logout,
}));
vi.mock('../components/device-control/screenshots/screenshotStore', () => ({
  clearAllScreenshotStores: calls.clear,
}));

import { AuthProvider, useAuth } from './auth-context';

describe('signOut', () => {
  it('removes the screenshots kept in this browser', async () => {
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { href: '' }, configurable: true });
    let signOut: () => Promise<void> = async () => undefined;
    function Probe() {
      signOut = useAuth().signOut;
      return null;
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(() => signOut());
    await waitFor(() => expect(calls.clear).toHaveBeenCalledTimes(1));
    expect(calls.logout).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/xenon/login');
    Object.defineProperty(window, 'location', { value: original, configurable: true });
  });
});
