import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './toast';

function Trigger({ onUndo }: { onUndo: () => void }) {
  const { toast } = useToast();
  return (
    <button
      onClick={() =>
        toast('Deleted Screenshot 3', 'info', 6000, { label: 'Undo', onClick: onUndo })
      }
    >
      go
    </button>
  );
}

describe('toast action', () => {
  afterEach(() => vi.useRealTimers());

  it('runs the action once and closes the toast', () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    expect(screen.getByText('Deleted Screenshot 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Deleted Screenshot 3')).not.toBeInTheDocument();
  });

  it('goes after its duration, and the action with it', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger onUndo={vi.fn()} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    act(() => {
      vi.advanceTimersByTime(6001);
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });
});
