import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  LineChart,
  MAX_POINTS,
  linePath,
  nearestIndex,
  niceMax,
  sampleIndexes,
} from './line-chart';

describe('line chart maths', () => {
  it('rounds the axis up to a round number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(8);
    expect(niceMax(12)).toBe(15);
    expect(niceMax(21)).toBe(25);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(326.6)).toBe(400);
    expect(niceMax(5620.8)).toBe(6000);
  });

  it('finds the sample nearest a time', () => {
    const times = [0, 2000, 4000];
    expect(nearestIndex(times, 2900)).toBe(1);
    expect(nearestIndex(times, 3100)).toBe(2);
    expect(nearestIndex(times, -5)).toBe(0);
    expect(nearestIndex(times, 99_999)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it('draws a long session with at most 600 points, always ending at the last sample', () => {
    expect(sampleIndexes(5)).toEqual([0, 1, 2, 3, 4]);
    const idx = sampleIndexes(5000);
    expect(idx.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(4999);
  });

  it('breaks a line where a value is missing', () => {
    expect(linePath([10, null, 30, 40], [0, 1, 2, 3], [0, 1, 2, 3], 3, 40, 300, 100)).toBe(
      'M0 75 M200 25 L300 0',
    );
  });
});

describe('LineChart', () => {
  const series = [
    { key: 'device', label: 'Device', color: 'var(--color-info)', values: [10, 20, 30] },
    { key: 'app', label: 'App', color: 'var(--color-accent)', values: [1, null, 3] },
  ];

  it('draws a line per series', () => {
    render(
      <LineChart
        ariaLabel="CPU over the session"
        times={[0, 2000, 4000]}
        series={series}
        yMax={100}
        formatValue={(v) => `${v}%`}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'CPU over the session' }).querySelectorAll('path'),
    ).toHaveLength(2);
  });

  it("shows each line's value at the hovered time, and hides it on leaving", () => {
    render(
      <LineChart
        ariaLabel="CPU over the session"
        times={[0, 2000, 4000]}
        series={series}
        yMax={100}
        formatValue={(v) => `${v}%`}
      />,
    );
    const box = screen.getByTestId('line-chart');
    box.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 400,
        top: 0,
        height: 140,
        right: 400,
        bottom: 140,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseMove(box, { clientX: 200 });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('0:02');
    expect(tip.textContent).toContain('Device20%');
    expect(tip.textContent).toContain('App—');

    fireEvent.mouseLeave(box);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
