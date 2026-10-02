import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopyButton } from './copy-language-modal';

describe('CopyButton', () => {
  afterEach(() => localStorage.removeItem('xenon.copyLang'));

  it('copies the fix as code in the remembered language', async () => {
    localStorage.setItem('xenon.copyLang', 'python');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onCopied = vi.fn();
    render(<CopyButton strategy="accessibility id" value="confirm_order" onCopied={onCopied} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy as Py' }));

    await waitFor(() => expect(onCopied).toHaveBeenCalledWith('python'));
    expect(writeText.mock.calls[0][0]).toContain('confirm_order');
  });

  it('asks for a language the first time', () => {
    render(<CopyButton strategy="xpath" value="//a" onCopied={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as code' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
