import { describe, expect, it } from 'vitest';
import {
  METHOD_EXPLANATIONS,
  activityText,
  compareNote,
  formatDuration,
  formatRelative,
  shareText,
  statusText,
  strategyLabel,
} from './format';
import { ISelectorStateView } from '../../interfaces/IHealingEvent';

describe('Selector Health wording', () => {
  it('says how long, in the largest unit that reads well', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(400)).toBe('<1 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(14 * 60_000)).toBe('14 min');
    expect(formatDuration(2.34 * 3_600_000)).toBe('2.3 h');
    expect(formatDuration(30 * 3_600_000)).toBe('30 h');
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(formatRelative(null, now)).toBe('—');
    expect(formatRelative('2026-10-02T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-10-02T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelative('2026-10-02T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-10-01T09:00:00Z', now)).toBe('yesterday');
    expect(formatRelative('2026-09-28T09:00:00Z', now)).toBe('4 days ago');
  });

  it('compares with the period before, in words, fewer being good', () => {
    expect(compareNote(7, 9, 30, 'count')).toEqual({
      text: '2 fewer than the 30 days before',
      tone: 'good',
    });
    expect(compareNote(265, 190, 30, 'percent')).toEqual({
      text: '39% more than the 30 days before',
      tone: 'bad',
    });
    expect(compareNote(5, 5, 7, 'percent')).toEqual({
      text: 'Same as the 7 days before',
      tone: 'neutral',
    });
    expect(compareNote(4, 0, 7, 'count')).toEqual({ text: 'None the 7 days before', tone: 'bad' });
    expect(compareNote(1001, 1000, 30, 'percent')).toEqual({
      text: 'About the same as the 30 days before',
      tone: 'neutral',
    });
    expect(compareNote(60_000, 240_000, 30, 'duration')).toEqual({
      text: '3 min less than the 30 days before',
      tone: 'good',
    });
  });

  it('names a status, a share, an activity and a selector type plainly', () => {
    expect(statusText(null)).toBe('To fix');
    expect(statusText({ status: 'pending', cleanBuilds: 2 } as ISelectorStateView)).toBe(
      'Being verified, 2 of 3 clean builds',
    );
    expect(statusText({ status: 'resolved' } as ISelectorStateView)).toBe('Fixed');
    expect(shareText(0.824)).toBe('82% of heals');
    expect(
      activityText({ action: 'muted', at: '', by: { id: 'u', name: 'Priya' }, reason: null }),
    ).toBe('Muted by Priya');
    expect(
      activityText({
        action: 'marked_fixed',
        at: '',
        by: { id: 'gone', name: null },
        reason: null,
      }),
    ).toBe('Marked fixed');
    expect(strategyLabel('')).toBe('Unknown type');
    expect(strategyLabel('xpath')).toBe('XPath');
    expect(METHOD_EXPLANATIONS['Visual AI']).toBe('Found it in a screenshot with AI');
  });
});
