import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listApps: vi.fn(),
  getApps: vi.fn(),
  installRepositoryApp: vi.fn(),
  uploadAndInstallApp: vi.fn(),
  uninstallApp: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn(() => 't'));
vi.mock('../../../api-service', () => ({ default: api }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
const copy = vi.hoisted(() => ({ ok: true }));
vi.mock('./copyText', async (orig) => ({
  ...(await orig<typeof import('./copyText')>()),
  copyText: vi.fn(async () => copy.ok),
}));

import { AppsSection } from './AppsSection';

const U = '381103b720057ece';
const told = (tone: string) =>
  toast.mock.calls.filter((c) => (c as unknown[])[1] === tone).map((c) => (c as unknown[])[0]);

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
const open = (platform = 'android') =>
  render(
    <MemoryRouter initialEntries={['/devices/x/control/actions']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <AppsSection udid={U} platform={platform} deviceName="Galaxy S9+" />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
const rows = () =>
  within(screen.getByRole('list', { name: 'Installed apps' })).getAllByRole('listitem');

beforeEach(() => {
  vi.clearAllMocks();
  copy.ok = true;
  api.listApps.mockResolvedValue(['com.zeta.app', 'com.alpha.app', 'io.appium.settings']);
  api.getApps.mockResolvedValue([
    { id: 'lib-a', name: 'Shop', platform: 'android', version: '2.1', packageName: 'com.shop' },
    { id: 'lib-i', name: 'Shop iOS', platform: 'ios', version: '2.1', packageName: 'com.shop' },
  ]);
  api.installRepositoryApp.mockResolvedValue({ success: true });
  api.uploadAndInstallApp.mockResolvedValue({ success: true });
  api.uninstallApp.mockResolvedValue({ success: true });
});

describe('installed apps', () => {
  it('lists them sorted, and search filters', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows()[0]).toHaveTextContent('com.alpha.app');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search installed apps' }), {
      target: { value: 'ZETA' },
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('com.zeta.app');
  });

  it('says when nothing matches, and offers a typed package id', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const search = screen.getByRole('searchbox', { name: 'Search installed apps' });
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No apps match “zzz”')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'com.android.chrome' } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Not in the list');
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall com.android.chrome' }));
    expect(screen.getByRole('dialog', { name: 'Uninstall app?' })).toHaveTextContent(
      'com.android.chrome',
    );
  });

  it('says why the list failed, and Retry reloads it', async () => {
    api.listApps.mockRejectedValueOnce(new Error('adb offline'));
    open();
    expect(await screen.findByText(/Couldn’t load the apps: adb offline/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('says when there are none', async () => {
    api.listApps.mockResolvedValue([]);
    open();
    expect(await screen.findByText('No apps installed')).toBeInTheDocument();
  });

  it('asks before uninstalling; Cancel does nothing, Uninstall does', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall com.alpha.app' }));
    let dialog = screen.getByRole('dialog', { name: 'Uninstall app?' });
    expect(dialog).toHaveTextContent('com.alpha.app');
    expect(dialog).toHaveTextContent('Galaxy S9+');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.uninstallApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall com.alpha.app' }));
    dialog = screen.getByRole('dialog', { name: 'Uninstall app?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(api.uninstallApp).toHaveBeenCalledWith(U, 'com.alpha.app'));
    await waitFor(() =>
      expect(told('success')).toContain('Uninstalled com.alpha.app from Galaxy S9+'),
    );
  });

  it('copies a package id, and selects it when the browser blocks copying', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Copy com.alpha.app' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    copy.ok = false;
    fireEvent.click(screen.getByRole('button', { name: 'Copy com.zeta.app' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('blocked copying'), 'info'),
    );
    expect(window.getSelection()?.toString()).toBe('com.zeta.app');
  });
});

describe('install from library', () => {
  it('lists only this platform’s builds, and installs the one chosen', async () => {
    open('android');
    fireEvent.click(screen.getByRole('button', { name: 'Install from library' }));
    const item = await screen.findByRole('menuitem', { name: /Shop/ });
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(item).toHaveTextContent('2.1 · com.shop');
    fireEvent.click(item);
    await waitFor(() => expect(api.installRepositoryApp).toHaveBeenCalledWith(U, 'lib-a'));
    expect(toast).toHaveBeenCalledWith('Installing Shop on Galaxy S9+…', 'loading', 0);
    await waitFor(() => expect(told('success')).toContain('Installed Shop on Galaxy S9+'));
  });

  it('says why a library install failed', async () => {
    api.installRepositoryApp.mockResolvedValue({
      success: false,
      error: 'INSTALL_FAILED_OLDER_SDK',
    });
    open('android');
    fireEvent.click(screen.getByRole('button', { name: 'Install from library' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Shop/ }));
    await waitFor(() =>
      expect(told('error')).toContain('Couldn’t install Shop: INSTALL_FAILED_OLDER_SDK'),
    );
  });

  it('points to the Apps library when it has nothing for this platform', async () => {
    api.getApps.mockResolvedValue([{ id: 'lib-i', name: 'Shop iOS', platform: 'ios' }]);
    open('android');
    fireEvent.click(screen.getByRole('button', { name: 'Install from library' }));
    expect(await screen.findByText('No Android apps in the library yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open the Apps library' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps');
  });
});

describe('upload file', () => {
  it('accepts this platform’s files and installs the one chosen', async () => {
    open('ios');
    const input = screen.getByLabelText('App file to upload');
    expect(input).toHaveAttribute('accept', '.ipa,.app');
    fireEvent.change(input, { target: { files: [new File(['x'], 'Shop.ipa')] } });
    await waitFor(() => expect(api.uploadAndInstallApp).toHaveBeenCalledWith(U, expect.any(File)));
    await waitFor(() => expect(told('success')).toContain('Installed Shop.ipa on Galaxy S9+'));
  });
});
