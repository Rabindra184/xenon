import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrendChart } from './trend-chart';
import { formatDay } from './format';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 30);
const trend = [
  { t: t0, heals: 3, aiHeals: 1 },
  { t: t0 + DAY, heals: 5, aiHeals: 0 },
  { t: t0 + 2 * DAY, heals: 0, aiHeals: 0 },
];

describe('TrendChart', () => {
  it('draws heals and AI heals per day, with their totals', () => {
    render(<TrendChart trend={trend} days={30} />);
    expect(screen.getByRole('img', { name: 'Heals per day' })).toBeTruthy();
    expect(screen.getByText('All heals').parentElement?.textContent).toContain('8');
    expect(screen.getByText('Heals that used AI').parentElement?.textContent).toContain('1');
  });

  it('names the hovered day', () => {
    render(<TrendChart trend={trend} days={30} />);
    const box = screen.getByTestId('line-chart');
    box.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 400,
        top: 0,
        height: 120,
        right: 400,
        bottom: 120,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent.mouseMove(box, { clientX: 200 });
    expect(screen.getByRole('tooltip').textContent).toContain(formatDay(t0 + DAY));
  });

  it('says so when there were no heals', () => {
    render(<TrendChart trend={[{ t: t0, heals: 0, aiHeals: 0 }]} days={7} />);
    expect(screen.getByText('No heals in the last 7 days.')).toBeTruthy();
  });
});
