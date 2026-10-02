import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryStrip } from './summary-strip';
import { IHealingSummaryResponse } from '../../interfaces/IHealingEvent';

const summary: IHealingSummaryResponse = {
  windowDays: 30,
  current: {
    totalHeals: 265,
    distinctSelectors: 7,
    sessionsTouched: 61,
    byTier: {},
    timeSpentMs: 14 * 60_000,
  },
  prior: {
    totalHeals: 190,
    distinctSelectors: 9,
    sessionsTouched: 50,
    byTier: {},
    timeSpentMs: 11 * 60_000,
  },
  trend: [],
};

describe('SummaryStrip', () => {
  it('shows the four numbers, each compared with the period before', () => {
    render(<SummaryStrip summary={summary} days={30} />);
    expect(screen.getByText('Selectors that needed healing')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('2 fewer than the 30 days before').className).toContain(
      'color-success',
    );
    expect(screen.getByText('39% more than the 30 days before').className).toContain(
      'color-danger',
    );
    expect(screen.getByText('Sessions affected')).toBeTruthy();
    expect(screen.getByText('14 min')).toBeTruthy();
    expect(screen.getByText('3 min more than the 30 days before')).toBeTruthy();
  });

  it('shows dashes until the summary arrives', () => {
    render(<SummaryStrip summary={null} days={30} />);
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});
