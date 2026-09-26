import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ typeText: vi.fn(), getClipboard: vi.fn(), setClipboard: vi.fn() }));
const toast = vi.hoisted(() => vi.fn(() => 't'));
vi.mock('../../../api-service', () => ({ default: api }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
const copy = vi.hoisted(() => ({ ok: true }));
vi.mock('./copyText', async (orig) => ({
  ...(await orig<typeof import('./copyText')>()),
  copyText: vi.fn(async () => copy.ok),
}));

import { TextClipboardSection } from './TextClipboardSection';

const errors = () =>
  toast.mock.calls.filter((c) => (c as unknown[])[1] === 'error').map((c) => (c as unknown[])[0]);
const U = 'U1';
const render$ = (platform = 'android') =>
  render(<TextClipboardSection udid={U} platform={platform} />);

beforeEach(() => {
  vi.clearAllMocks();
  copy.ok = true;
  api.typeText.mockResolvedValue({});
  api.getClipboard.mockResolvedValue({ content: 'hello' });
  api.setClipboard.mockResolvedValue({ success: true });
});

describe('Send text', () => {
  it('sends with the button or Enter, then says Sent', async () => {
    render$();
    const field = screen.getByRole('textbox', { name: 'Send text' });
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.typeText).toHaveBeenCalledWith(U, 'abc'));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent');
    expect(field).toHaveValue('');
    fireEvent.change(field, { target: { value: 'def' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(api.typeText).toHaveBeenLastCalledWith(U, 'def'));
  });

  it('keeps the text and says why when sending fails', async () => {
    api.typeText.mockRejectedValue(new Error('no focused field'));
    render$();
    const field = screen.getByRole('textbox', { name: 'Send text' });
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(errors()).toContain('Couldn’t send the text: no focused field'));
    expect(field).toHaveValue('abc');
  });
});

describe('Clipboard', () => {
  it('reads the device clipboard into the field', async () => {
    render$();
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Clipboard' })).toHaveValue('hello'),
    );
  });

  it('says when the device clipboard is empty', async () => {
    api.getClipboard.mockResolvedValue({ content: '' });
    render$();
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The device clipboard is empty');
  });

  it('uses the platform’s own error when reading fails', async () => {
    api.getClipboard.mockRejectedValue(new Error('WDA is not running'));
    render$('ios');
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    await waitFor(() =>
      expect(errors()).toContain('Couldn’t read the clipboard: WDA is not running'),
    );
  });

  it('writes the field to the device, only when there is text', async () => {
    render$();
    const write = screen.getByRole('button', { name: 'Write to device' });
    expect(write).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Clipboard' }), {
      target: { value: 'token-123' },
    });
    fireEvent.click(write);
    await waitFor(() => expect(api.setClipboard).toHaveBeenCalledWith(U, 'token-123'));
    expect(await screen.findByRole('status')).toHaveTextContent('Written to the device');
  });

  it('says why writing failed', async () => {
    api.setClipboard.mockRejectedValue(new Error('denied'));
    render$();
    fireEvent.change(screen.getByRole('textbox', { name: 'Clipboard' }), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Write to device' }));
    await waitFor(() => expect(errors()).toContain('Couldn’t write the clipboard: denied'));
  });

  it('copies to your clipboard, and selects the text when the browser blocks it', async () => {
    render$();
    const field = screen.getByRole('textbox', { name: 'Clipboard' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy clipboard text' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    copy.ok = false;
    const select = vi.spyOn(field, 'select');
    fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('blocked copying'), 'info');
  });
});
