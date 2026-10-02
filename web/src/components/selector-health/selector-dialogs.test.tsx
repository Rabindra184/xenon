import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarkFixedDialog, MuteDialog, MUTE_REASON_MAX } from './selector-dialogs';

describe('Selector Health dialogs', () => {
  it('confirms marking fixed, saying what happens next', () => {
    const onConfirm = vi.fn();
    render(<MarkFixedDialog open busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByText(/watches the next 3 clean builds/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark fixed' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('mutes with an optional reason, trimmed, of at most 500 characters', () => {
    const onConfirm = vi.fn();
    render(<MuteDialog open busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    const reason = screen.getByLabelText('Reason (optional)');
    expect(reason.getAttribute('maxLength')).toBe(String(MUTE_REASON_MAX));
    fireEvent.change(reason, { target: { value: '  Screen being redesigned  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(onConfirm).toHaveBeenCalledWith('Screen being redesigned');
  });
});
