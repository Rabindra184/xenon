import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select } from './select';

describe('Select', () => {
  it('renders options, applies the base class, and honors value', () => {
    render(
      <Select aria-label="role" defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    const el = screen.getByLabelText('role') as HTMLSelectElement;
    expect(el).toBeInTheDocument();
    expect(el.tagName).toBe('SELECT');
    expect(el.className).toContain('select-base');
    expect(el.value).toBe('b');
  });

  it('applies the compact size class', () => {
    render(
      <Select aria-label="s" selectSize="sm">
        <option value="x">X</option>
      </Select>,
    );
    expect(screen.getByLabelText('s').className).toContain('select-sm');
  });
});
