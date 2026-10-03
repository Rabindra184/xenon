import { describe, expect, it } from 'vitest';
import { splitMatches } from './findHighlight';

describe('splitMatches', () => {
  it('gives the whole text when there is nothing to find', () => {
    expect(splitMatches('Wifi on', '', false)).toEqual([{ text: 'Wifi on', hit: false }]);
    expect(splitMatches('Wifi on', 'zzz', false)).toEqual([{ text: 'Wifi on', hit: false }]);
  });

  it('finds every match, ignoring case by default, and keeps the text as written', () => {
    expect(splitMatches('Wifi on, wifi off', 'WIFI', false)).toEqual([
      { text: 'Wifi', hit: true },
      { text: ' on, ', hit: false },
      { text: 'wifi', hit: true },
      { text: ' off', hit: false },
    ]);
  });

  it('finds only the exact case with Match case on', () => {
    expect(splitMatches('Wifi on, wifi off', 'wifi', true)).toEqual([
      { text: 'Wifi on, ', hit: false },
      { text: 'wifi', hit: true },
      { text: ' off', hit: false },
    ]);
  });

  it('handles matches at both ends and side by side', () => {
    expect(splitMatches('aaaa', 'aa', false)).toEqual([
      { text: 'aa', hit: true },
      { text: 'aa', hit: true },
    ]);
  });
});
