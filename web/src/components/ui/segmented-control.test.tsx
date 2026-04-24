import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';

describe('SegmentedControl', () => {
  it('highlights active and fires onChange', () => {
    const fn = vi.fn();
    render(
      <SegmentedControl
        segments={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value="a"
        onChange={fn}
      />,
    );
    expect(screen.getByRole('tab', { name: 'A' })).toHaveClass('seg-btn-active');
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('renders counts when provided', () => {
    render(
      <SegmentedControl
        segments={[
          { value: 'a', label: 'A', count: 3 },
          { value: 'b', label: 'B', count: 0 },
        ]}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('3')).toHaveClass('seg-count');
    expect(screen.getByText('0')).toHaveClass('seg-count');
  });
});
