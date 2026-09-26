import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IdleReleaseBanner } from './IdleReleaseBanner';

describe('IdleReleaseBanner', () => {
  it('says what happened and offers Restore and Dismiss', () => {
    const onRestore = vi.fn();
    const onDismiss = vi.fn();
    render(
      <IdleReleaseBanner
        message="Released 1 device."
        onRestore={onRestore}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Released 1 device.');
    fireEvent.click(screen.getByRole('button', { name: 'Restore devices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('offers only Dismiss after a partial restore', () => {
    render(<IdleReleaseBanner message="Restored 1 device." onDismiss={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Restore devices' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
});
