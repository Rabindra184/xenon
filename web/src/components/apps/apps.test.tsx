import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Apps from './apps';
import { ToastProvider } from '../ui/toast';
import XenonApiService from '../../api-service';

vi.mock('../../api-service', () => ({
  default: {
    getApps: vi.fn().mockResolvedValue([
      {
        id: 'a1',
        name: 'wda-signed.ipa',
        packageName: 'internal.bundle',
        platform: 'ios',
        version: '1.0.0',
        size: 6300000,
        createdAt: '2026-08-12T21:20:28Z',
      },
    ]),
    getDevices: vi.fn().mockResolvedValue([]),
    uploadApp: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const renderApps = () =>
  render(
    <ToastProvider>
      <Apps />
    </ToastProvider>,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Apps header actions', () => {
  it('has one primary action: Upload app. Refresh is secondary', async () => {
    renderApps();
    const refresh = await screen.findByRole('button', { name: /Refresh/ });
    const upload = screen.getByRole('button', { name: /Upload app/ });
    expect(refresh).toHaveClass('btn-secondary');
    expect(refresh).not.toHaveClass('btn-primary');
    expect(upload).toHaveClass('btn-primary');
  });

  it('opens the file picker when Upload app is clicked', async () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderApps();
    fireEvent.click(await screen.findByRole('button', { name: /Upload app/ }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.instances[0]).toMatchObject({ type: 'file', accept: '.apk,.ipa' });
  });

  it('uploads the chosen file', async () => {
    const { container } = renderApps();
    await screen.findByRole('button', { name: /Upload app/ });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'app.apk');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(XenonApiService.uploadApp).toHaveBeenCalledWith(file));
  });
});
