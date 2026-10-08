import { describe, expect, it } from 'vitest';
import { fileStem, logFileName } from '../src/main/fileNames';

describe('fileStem', () => {
  it('keeps letters, digits, dashes and underscores, and joins the rest with an underscore', () => {
    expect(fileStem('Local server', 'profile')).toBe('Local_server');
    expect(fileStem('QA Lab — iOS', 'profile')).toBe('QA_Lab_iOS');
    expect(fileStem('ci-runner_2', 'profile')).toBe('ci-runner_2');
  });

  it('uses the fallback for an empty name', () => {
    expect(fileStem('', 'profile')).toBe('profile');
  });

  // An imported file can hold anything where the name goes.
  it('uses the fallback for a name that is not text, never throwing', () => {
    for (const name of [42, null, undefined, {}, ['a']]) {
      expect(fileStem(name, 'profile')).toBe('profile');
    }
  });

  it('keeps it short when asked', () => {
    expect(fileStem('a'.repeat(60), 'server', 40)).toBe('a'.repeat(40));
  });
});

describe('logFileName', () => {
  it('is xenon-log-YYYY-MM-DD-HHMM.txt in local time', () => {
    expect(logFileName(new Date(2026, 9, 6, 14, 3, 59))).toBe('xenon-log-2026-10-06-1403.txt');
  });

  it('pads the month, day, hour and minute', () => {
    expect(logFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('xenon-log-2026-01-02-0304.txt');
    expect(logFileName(new Date(2026, 11, 31, 0, 0, 0))).toBe('xenon-log-2026-12-31-0000.txt');
  });
});
