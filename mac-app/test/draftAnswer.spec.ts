import { describe, expect, it } from 'vitest';
import { draftTakesAnswer } from '../src/renderer/src/draftAnswer';
import type { Profile } from '../src/shared/types';

const profile = (name: string) => ({ id: 'p1', name }) as Profile;

// R40: the window's draft takes the profile as main stored it (secrets moved to the Keychain)
// when nothing newer is on screen, so it stops sending values main has already moved.
describe('draftTakesAnswer', () => {
  it('takes the answer when the draft is still the copy that was saved and no edit waits', () => {
    const sent = profile('Lab');
    expect(draftTakesAnswer(sent, sent, null)).toBe(true);
  });

  it('keeps a newer edit: the draft changed after the save was sent', () => {
    expect(draftTakesAnswer(profile('Lab 2'), profile('Lab'), null)).toBe(false);
  });

  it('keeps the draft while an edit waits to be saved', () => {
    const sent = profile('Lab');
    expect(draftTakesAnswer(sent, sent, 'p1')).toBe(false);
  });

  it('leaves another open profile, or none, alone', () => {
    expect(draftTakesAnswer({ ...profile('Other'), id: 'p2' }, profile('Lab'), null)).toBe(false);
    expect(draftTakesAnswer(null, profile('Lab'), null)).toBe(false);
  });
});
