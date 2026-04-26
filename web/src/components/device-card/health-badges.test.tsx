import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HealthBadges } from './health-badges';

describe('HealthBadges', () => {
  it('returns null when both values are absent', () => {
    const { container } = render(<HealthBadges device={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when only thermalStatus is "Unknown"', () => {
    const { container } = render(
      <HealthBadges device={{ thermalStatus: 'Unknown' }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a green battery pill when battery is healthy', () => {
    const { container } = render(<HealthBadges device={{ batteryLevel: 87 }} />);
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-ready');
    expect(pills[0].textContent).toContain('87%');
  });

  it('renders a yellow battery pill when battery is in the warning range', () => {
    const { container } = render(<HealthBadges device={{ batteryLevel: 35 }} />);
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-reserved');
  });

  it('renders a red battery pill when battery is critical', () => {
    const { container } = render(<HealthBadges device={{ batteryLevel: 12 }} />);
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-error');
  });

  it('renders a green thermal pill when thermalStatus is Normal', () => {
    const { container } = render(
      <HealthBadges device={{ thermalStatus: 'Normal' }} />,
    );
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-ready');
    expect(pills[0].textContent).toContain('Normal');
  });

  it('renders a red thermal pill when thermalStatus is Critical', () => {
    const { container } = render(
      <HealthBadges device={{ thermalStatus: 'Critical' }} />,
    );
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-error');
  });

  it('renders a yellow thermal pill for any other non-empty value', () => {
    const { container } = render(
      <HealthBadges device={{ thermalStatus: 'Hot' }} />,
    );
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-reserved');
  });

  it('renders both pills when both values are present', () => {
    const { container } = render(
      <HealthBadges device={{ batteryLevel: 15, thermalStatus: 'Critical' }} />,
    );
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveClass('pill-error');
    expect(pills[1]).toHaveClass('pill-error');
  });
});
