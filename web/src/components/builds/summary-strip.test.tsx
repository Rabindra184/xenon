import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryStrip } from './summary-strip';
import type { ISessionSummary } from '../../interfaces/ISessionSummary';

const summary = (over: Partial<ISessionSummary> = {}): ISessionSummary => ({
  since: '2026-09-24T12:00:00.000Z',
  current: { total: 22, passed: 18, failed: 3, running: 1, medianMs: 72_000, p90Ms: 220_000 },
  previous: { total: 18, passed: 15, failed: 3, running: 0 },
  runningNow: { sessions: 1, devices: 1 },
  ...over,
});

describe('SummaryStrip', () => {
  it('shows the pass rate, and its change from the period before', () => {
    render(<SummaryStrip summary={summary()} periodLabel="7 days" />);
    expect(screen.getByText('86%')).toBeInTheDocument();
    // 85.7% now against 83.3% before.
    expect(screen.getByText('+2 pts vs prior 7 days')).toBeInTheDocument();
  });

  it('says when the pass rate fell', () => {
    render(
      <SummaryStrip
        summary={summary({ previous: { total: 10, passed: 10, failed: 0, running: 0 } })}
        periodLabel="7 days"
      />,
    );
    expect(screen.getByText('−14 pts vs prior 7 days')).toBeInTheDocument();
  });

  it('shows what passed out of what was rated when there is no period before', () => {
    render(<SummaryStrip summary={summary({ since: null, previous: null })} periodLabel={null} />);
    expect(screen.getByText('18 of 21 passed')).toBeInTheDocument();
  });

  it('shows failures, what runs now, and how long sessions take', () => {
    render(<SummaryStrip summary={summary()} periodLabel="7 days" />);
    expect(screen.getByText('of 22 sessions')).toBeInTheDocument();
    expect(screen.getByText('on 1 device')).toBeInTheDocument();
    expect(screen.getByText('1m 12s')).toBeInTheDocument();
    expect(screen.getByText('p90 3m 40s')).toBeInTheDocument();
  });

  it('shows dashes, not zeros, before the summary arrives', () => {
    render(<SummaryStrip summary={null} periodLabel="7 days" />);
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it('has nothing to rate or time when nothing has finished', () => {
    render(
      <SummaryStrip
        summary={summary({
          current: { total: 1, passed: 0, failed: 0, running: 1, medianMs: null, p90Ms: null },
          previous: { total: 0, passed: 0, failed: 0, running: 0 },
        })}
        periodLabel="24 hours"
      />,
    );
    expect(screen.getAllByText('No finished sessions')).toHaveLength(2);
  });
});
