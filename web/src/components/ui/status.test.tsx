import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from './StatusDot';
import { StatusCode } from './StatusCode';

describe('StatusDot', () => {
  it('applies status class from kind prop', () => {
    const { container } = render(<StatusDot kind="ready" />);
    expect(container.firstChild).toHaveClass('status-dot-ready');
  });
});

describe('StatusCode', () => {
  it('renders uppercase label with status class', () => {
    render(<StatusCode kind="busy">busy</StatusCode>);
    const code = screen.getByText(/BUSY/);
    expect(code).toHaveClass('status-code-label');
    expect(code.parentElement).toHaveClass('status-code-busy');
  });

  it('renders its own dot when showDot is true', () => {
    const { container } = render(<StatusCode kind="reserved" showDot>reserved</StatusCode>);
    expect(container.querySelector('.status-dot-reserved')).toBeInTheDocument();
  });
});
