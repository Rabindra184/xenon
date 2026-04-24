import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldGroup } from './FieldGroup';

describe('FieldGroup', () => {
  it('renders label text', () => {
    render(
      <FieldGroup label="Reserved By">
        <input />
      </FieldGroup>,
    );
    expect(screen.getByText('Reserved By')).toBeInTheDocument();
  });

  it('renders description when provided, omits when not', () => {
    const { rerender, container } = render(
      <FieldGroup label="t" description="Press Enter to add multiple tags">
        <input />
      </FieldGroup>,
    );
    expect(screen.getByText('Press Enter to add multiple tags')).toBeInTheDocument();
    expect(container.querySelector('.fg-desc')).not.toBeNull();

    rerender(
      <FieldGroup label="t">
        <input />
      </FieldGroup>,
    );
    expect(container.querySelector('.fg-desc')).toBeNull();
  });

  it('renders error when provided, omits when not', () => {
    const { rerender, container } = render(
      <FieldGroup label="t" error="Please enter your name">
        <input />
      </FieldGroup>,
    );
    expect(screen.getByText('Please enter your name')).toBeInTheDocument();
    expect(container.querySelector('.fg-error')).not.toBeNull();

    rerender(
      <FieldGroup label="t">
        <input />
      </FieldGroup>,
    );
    expect(container.querySelector('.fg-error')).toBeNull();
  });

  it('wires htmlFor to the label element', () => {
    const { container } = render(
      <FieldGroup label="Tag" htmlFor="tag-input">
        <input id="tag-input" />
      </FieldGroup>,
    );
    const label = container.querySelector('label');
    expect(label?.getAttribute('for')).toBe('tag-input');
  });
});
