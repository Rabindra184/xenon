import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyValueRow } from './KeyValueRow';

describe('KeyValueRow', () => {
  it('renders label + value', () => {
    render(<KeyValueRow label="Battery" value="92%" />);
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
  });
  it('uses mono class when mono=true', () => {
    render(<KeyValueRow label="Host" value="10.0.1.42" mono />);
    expect(screen.getByText('10.0.1.42')).toHaveClass('kv-value-mono');
  });
});
