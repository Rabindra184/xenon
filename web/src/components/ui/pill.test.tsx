import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
  it('renders children inside a pill', () => {
    render(<Pill>team-qa</Pill>);
    expect(screen.getByText('team-qa')).toHaveClass('pill');
  });
  it('applies tone class', () => {
    render(<Pill tone="ready">a</Pill>);
    expect(screen.getByText('a')).toHaveClass('pill-ready');
  });
  it('adds a caller’s class beside its own', () => {
    render(
      <Pill tone="ready" className="dc2-team">
        a
      </Pill>,
    );
    expect(screen.getByText('a')).toHaveClass('pill', 'pill-ready', 'dc2-team');
  });
});
