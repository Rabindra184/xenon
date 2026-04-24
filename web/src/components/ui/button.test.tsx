import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button v2', () => {
  it('defaults to primary variant', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-primary');
  });

  it('supports outline variant via `secondary`', () => {
    render(<Button variant="secondary">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-secondary');
  });

  it('supports ghost variant', () => {
    render(<Button variant="ghost">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-ghost');
  });

  it('supports danger variant', () => {
    render(<Button variant="danger">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-danger');
  });

  it('supports sm size', () => {
    render(<Button size="sm">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-size-sm');
  });

  it('legacy `default` variant still maps to primary for back-compat', () => {
    render(<Button variant="default">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-primary');
  });

  it('legacy `outline` maps to secondary', () => {
    render(<Button variant="outline">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-secondary');
  });
});
