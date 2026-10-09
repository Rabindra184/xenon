import { describe, expect, it } from 'vitest';
import { fileStem } from '../src/main/fileNames';

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
