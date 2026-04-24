import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingCard } from './SettingCard';

describe('SettingCard', () => {
  it('renders icon and title', () => {
    render(
      <SettingCard icon={<span data-testid="icon">I</span>} title="Retention Window">
        <input />
      </SettingCard>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Retention Window' })).toBeInTheDocument();
  });

  it('renders description when provided, omits when not', () => {
    const { rerender, container } = render(
      <SettingCard icon={<span />} title="t" description="A prose description.">
        <input />
      </SettingCard>,
    );
    expect(screen.getByText('A prose description.')).toBeInTheDocument();
    expect(container.querySelector('.setting-card-description')).not.toBeNull();

    rerender(
      <SettingCard icon={<span />} title="t">
        <input />
      </SettingCard>,
    );
    expect(container.querySelector('.setting-card-description')).toBeNull();
  });

  it('renders children inside .setting-card-field', () => {
    const { container } = render(
      <SettingCard icon={<span />} title="t">
        <input data-testid="child" />
      </SettingCard>,
    );
    const field = container.querySelector('.setting-card-field');
    expect(field).not.toBeNull();
    expect(field?.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('renders hint when provided, omits when not', () => {
    const { rerender, container } = render(
      <SettingCard icon={<span />} title="t" hint="Minimum safe value: 5000ms.">
        <input />
      </SettingCard>,
    );
    expect(screen.getByText('Minimum safe value: 5000ms.')).toBeInTheDocument();
    expect(container.querySelector('.setting-card-hint')).not.toBeNull();

    rerender(
      <SettingCard icon={<span />} title="t">
        <input />
      </SettingCard>,
    );
    expect(container.querySelector('.setting-card-hint')).toBeNull();
  });

  it('renders h4 heading (not other levels)', () => {
    render(
      <SettingCard icon={<span />} title="AI Self-Healing">
        <input />
      </SettingCard>,
    );
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(screen.getByRole('heading', { level: 4 })).toBeInTheDocument();
  });
});
