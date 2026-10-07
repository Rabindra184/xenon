import { describe, expect, it } from 'vitest';
import { profileToOpen } from '../src/renderer/src/profileChoice';

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('profileToOpen', () => {
  it('opens the profile the window had open last, wherever it is in the list', () => {
    expect(profileToOpen(list, 'b')).toBe('b');
    expect(profileToOpen(list, 'c')).toBe('c');
  });

  it('opens the first profile when none was open before', () => {
    expect(profileToOpen(list, null)).toBe('a');
  });

  it('opens the first profile when the one that was open has since been deleted', () => {
    expect(profileToOpen(list, 'gone')).toBe('a');
  });

  it('opens nothing when there are no profiles', () => {
    expect(profileToOpen([], 'b')).toBeNull();
    expect(profileToOpen([], null)).toBeNull();
  });
});
