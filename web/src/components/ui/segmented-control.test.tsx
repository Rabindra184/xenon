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

  // Devices' status filters: the dot matches the colour of that state's cards.
  it('shows a status dot for a segment with a tone', () => {
    render(
      <SegmentedControl
        segments={[
          { value: 'all', label: 'All' },
          { value: 'ready', label: 'Ready', tone: 'ready' },
        ]}
        value="all"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('tab', { name: /Ready/ }).querySelector('.status-dot-ready'),
    ).not.toBeNull();
    expect(screen.getByRole('tab', { name: /All/ }).querySelector('.status-dot')).toBeNull();
  });

  // Six filters with counts; the empty ones recede so the rest stand out.
  it('marks a zero count so it can recede', () => {
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
    expect(screen.getByText('0')).toHaveClass('seg-count-zero');
    expect(screen.getByText('3')).not.toHaveClass('seg-count-zero');
  });

  it('disables a segment, explains why, and ignores clicks on it', () => {
    const fn = vi.fn();
    render(
      <SegmentedControl
        segments={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true, title: 'Not yet' },
        ]}
        value="a"
        onChange={fn}
      />,
    );
    const b = screen.getByRole('tab', { name: 'B' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Not yet');
    fireEvent.click(b);
    expect(fn).not.toHaveBeenCalled();
  });

  it('declares a keyboard shortcut on a segment', () => {
    render(
      <SegmentedControl
        segments={[{ value: 'a', label: 'A', keyShortcuts: 'Escape' }]}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-keyshortcuts', 'Escape');
  });

  // Devices has three filter controls; unnamed, a screen reader hears three
  // identical tab lists.
  it('names the control when given a label', () => {
    render(
      <SegmentedControl
        label="Platform"
        segments={[{ value: 'a', label: 'A' }]}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Platform' })).toBeInTheDocument();
  });
});
