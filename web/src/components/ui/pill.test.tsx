import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
  it('renders children inside a pill', () => {
    render(<Pill>team-qa</Pill>);
    expect(screen.getByText('team-qa')).toHaveClass('pill');
  });
  it('applies tone class', () => {
    render(<Pill tone="accent">a</Pill>);
    expect(screen.getByText('a')).toHaveClass('pill-accent');
  });
});
