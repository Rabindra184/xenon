import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/renderer/src/copy/profiles';

// M6: the Profiles sheet's description says what its buttons do, in the buttons' own words.
describe('the Profiles sheet’s words', () => {
  const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];
  const description = words(PROFILES.sheet.description);

  it('names each of its buttons by the button’s own word', () => {
    const { rename, duplicate, delete: remove, import: bringIn, export: sendOut } = PROFILES.sheet;
    for (const button of [rename, duplicate, remove, bringIn, sendOut]) {
      expect(description).toContain(words(button)[0]);
    }
  });

  it('uses no other word for them (copy, remove)', () => {
    expect(description).not.toContain('copy');
    expect(description).not.toContain('remove');
  });
});
