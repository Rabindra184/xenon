import { describe, it, expect } from 'vitest';
import { platformLabel, sentenceCase } from './labels';

describe('labels', () => {
  it.each([
    ['android', 'Android'],
    ['ANDROID', 'Android'],
    ['ios', 'iOS'],
    ['androidtv', 'Android TV'],
    ['windows', 'Windows'],
    ['', ''],
  ])('platformLabel(%s) = %s', (p, out) => expect(platformLabel(p)).toBe(out));

  it('sentence-cases status values', () => {
    expect(sentenceCase('RUNNING')).toBe('Running');
    expect(sentenceCase('not_started')).toBe('Not started');
    expect(sentenceCase(null)).toBe('');
  });
});
