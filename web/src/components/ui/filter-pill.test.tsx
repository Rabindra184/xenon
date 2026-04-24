import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterPill } from './filter-pill';

describe('FilterPill', () => {
  it('renders label and count', () => {
    render(<FilterPill label="FAILED" count={5} active={false} onClick={() => {}} tone="red" />);
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const spy = vi.fn();
    render(<FilterPill label="FAILED" count={5} active={false} onClick={spy} tone="red" />);
    fireEvent.click(screen.getByRole('button'));
    expect(spy).toHaveBeenCalledOnce();
  });

  it('exposes aria-pressed when active', () => {
    render(<FilterPill label="FAILED" count={5} active onClick={() => {}} tone="red" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides bullet when bullet={false}', () => {
    const { container } = render(
      <FilterPill label="ALL" count={2} active onClick={() => {}} tone="neutral" bullet={false} />,
    );
    expect(container.querySelectorAll('.rounded-full').length).toBe(0);
  });

  it('omits count when undefined', () => {
    render(<FilterPill label="ALL" active onClick={() => {}} tone="neutral" />);
    expect(screen.queryByText(/\d+/)).toBeNull();
  });
});
