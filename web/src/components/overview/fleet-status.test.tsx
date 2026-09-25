import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FleetStatus } from './fleet-status';

describe('FleetStatus filter', () => {
  it('exposes which filter is on, not just by colour', () => {
    render(
      <MemoryRouter>
        <FleetStatus devices={[]} />
      </MemoryRouter>,
    );
    const group = screen.getByRole('group', { name: 'Filter devices' });
    const all = screen.getByRole('button', { name: 'All' });
    const nonReady = screen.getByRole('button', { name: /Non-ready/ });
    expect(group).toContainElement(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(nonReady).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(nonReady);
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(nonReady).toHaveAttribute('aria-pressed', 'true');
  });
});
