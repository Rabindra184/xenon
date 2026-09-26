import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDevice } from '../../interfaces/IDevice';

// Device control starts a stream and loads panels on mount; these tests need
// the header and the Actions tab, so the rest is stubbed.
const api = vi.hoisted(() => ({
  startStream: vi.fn(),
  stopStream: vi.fn(),
  getDevices: vi.fn(),
  listApps: vi.fn(),
  uninstallApp: vi.fn(),
  typeText: vi.fn(),
  getClipboard: vi.fn(),
  swipe: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn(() => 'toast-id'));
vi.mock('../../api-service', () => ({ default: api }));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
vi.mock('./useDisplayState', () => ({ useDisplayState: () => 'on' }));
vi.mock('./logcat/LogcatView', () => ({ default: () => null }));
vi.mock('../omni-inspector/OmniInspector', () => ({ default: () => null }));
vi.mock('../bug-report/BugReportButton', () => ({ BugReportButton: () => null }));
vi.mock('../terminal/terminal', () => ({
  Terminal: ({ welcomeMessage }: { welcomeMessage?: string }) => (
    <pre data-testid="welcome">{welcomeMessage}</pre>
  ),
}));

import DeviceControl from './device-control';

const S9: IDevice = {
  udid: '381103b720057ece',
  name: 'star2ltexx',
  marketingName: 'Galaxy S9+',
  host: 'http://127.0.0.1:4723',
  sdk: '10',
  platform: 'android',
  deviceType: 'real',
  realDevice: true,
  offline: false,
  userBlocked: false,
  busy: false,
};

const open = (device: IDevice, tab = 'actions') =>
  render(
    <MemoryRouter initialEntries={[`/devices/${device.udid}/control/${tab}`]}>
      <Routes>
        <Route
          path="/devices/:udid/control/:tab?"
          element={<DeviceControl device={device} onClose={() => {}} titleId="t" />}
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.startStream.mockResolvedValue({});
  api.stopStream.mockResolvedValue({});
  api.getDevices.mockResolvedValue([]);
  api.listApps.mockResolvedValue(['com.example.app', 'com.other.app']);
  api.uninstallApp.mockResolvedValue({ success: true });
  api.typeText.mockResolvedValue({});
  api.swipe.mockResolvedValue({});
});

const toasted = (tone: string) =>
  toast.mock.calls.filter((c) => (c as unknown[])[1] === tone).map((c) => (c as unknown[])[0]);

describe('DeviceControl header', () => {
  // The Devices card said "Galaxy S9+" and the control view it opened said
  // "star2ltexx".
  it('names the device as its card does', () => {
    open(S9);
    expect(screen.getByRole('heading', { name: 'Galaxy S9+' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'star2ltexx' })).toBeNull();
  });

  it('falls back to the reported name when the friendly one is unknown', () => {
    open({ ...S9, marketingName: null });
    expect(screen.getByRole('heading', { name: 'star2ltexx' })).toBeInTheDocument();
  });

  it('greets the shell with the same name', () => {
    open(S9, 'terminal');
    expect(screen.getByTestId('welcome')).toHaveTextContent(
      'Connected to Galaxy S9+ (381103b720057ece).',
    );
  });
});

describe('Actions tab', () => {
  const pickApp = async (id: string) => {
    const picker = screen.getByLabelText('Quick Uninstall');
    await screen.findByRole('option', { name: id });
    fireEvent.change(picker, { target: { value: id } });
  };

  // An uninstall deletes the app and its data from the phone; it ran on one
  // click, from a list of bare package ids.
  it('asks before uninstalling, naming the app and the device', async () => {
    open(S9);
    await pickApp('com.example.app');
    fireEvent.click(screen.getByRole('button', { name: /uninstall/i }));
    const dialog = screen.getByRole('dialog', { name: 'Uninstall app?' });
    expect(dialog).toHaveTextContent('com.example.app');
    expect(dialog).toHaveTextContent('Galaxy S9+');
    expect(api.uninstallApp).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.uninstallApp).not.toHaveBeenCalled();
  });

  it('uninstalls once confirmed and says so', async () => {
    open(S9);
    await pickApp('com.example.app');
    fireEvent.click(screen.getByRole('button', { name: /uninstall/i }));
    const dialog = screen.getByRole('dialog', { name: 'Uninstall app?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() =>
      expect(api.uninstallApp).toHaveBeenCalledWith('381103b720057ece', 'com.example.app'),
    );
    await waitFor(() =>
      expect(toasted('success')).toContain('Uninstalled com.example.app from Galaxy S9+'),
    );
  });

  it('says why an uninstall failed', async () => {
    api.uninstallApp.mockRejectedValue(new Error('not installed'));
    open(S9);
    await pickApp('com.example.app');
    fireEvent.click(screen.getByRole('button', { name: /uninstall/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() =>
      expect(toasted('error')).toContain('Couldn’t uninstall com.example.app: not installed'),
    );
  });

  // Enter was the only way to send, and nothing said whether it worked.
  it('sends text with a Send button and confirms it', async () => {
    open(S9);
    const field = screen.getByRole('textbox', { name: 'Text to send to the device' });
    fireEvent.change(field, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));
    await waitFor(() => expect(api.typeText).toHaveBeenCalledWith('381103b720057ece', 'hello'));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent');
    expect(field).toHaveValue('');
  });

  it('keeps the text and says why when sending fails', async () => {
    api.typeText.mockRejectedValue(new Error('no focused element'));
    open(S9);
    const field = screen.getByRole('textbox', { name: 'Text to send to the device' });
    fireEvent.change(field, { target: { value: 'hello' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(toasted('error')).toContain('Couldn’t send the text: no focused element'),
    );
    expect(field).toHaveValue('hello');
  });

  it('names the swipe buttons', () => {
    open(S9);
    for (const d of ['up', 'down', 'left', 'right']) {
      expect(screen.getByRole('button', { name: `Swipe ${d}` })).toBeInTheDocument();
    }
  });

  it('says why a swipe failed', async () => {
    api.swipe.mockRejectedValue(new Error('stream stopped'));
    open(S9);
    fireEvent.click(screen.getByRole('button', { name: 'Swipe up' }));
    await waitFor(() => expect(toasted('error')).toContain('Couldn’t swipe up: stream stopped'));
  });

  it('labels the app picker and the manual field', () => {
    open(S9);
    expect(screen.getByLabelText('Quick Uninstall').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Or enter manually:').tagName).toBe('INPUT');
  });

  // The file input was `hidden`, so Tab never reached "Select File".
  it('lets the keyboard reach the file chooser', () => {
    open(S9);
    const file = screen.getByLabelText(/Select File/);
    expect(file).toHaveAttribute('type', 'file');
    expect(file).not.toHaveAttribute('hidden');
  });

  it('shows the platform’s own clipboard error', async () => {
    api.getClipboard.mockRejectedValue(new Error('WDA is not running'));
    open({ ...S9, platform: 'ios', marketingName: 'iPhone 17 Pro' });
    fireEvent.click(screen.getByRole('button', { name: /fetch value/i }));
    expect(
      await screen.findByText('Couldn’t read the clipboard: WDA is not running'),
    ).toBeInTheDocument();
  });

  it('names the device, not its UDID, while installing', async () => {
    open(S9);
    const file = screen.getByLabelText(/Select File/);
    fireEvent.change(file, { target: { files: [new File(['x'], 'app.apk')] } });
    (api as any).uploadAndInstallApp = vi.fn().mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'INSTALL' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Installing app.apk on Galaxy S9+…', 'loading', 0),
    );
    await waitFor(() => expect(toasted('success')).toContain('Installed app.apk on Galaxy S9+'));
  });
});
