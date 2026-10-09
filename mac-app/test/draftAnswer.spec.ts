import { describe, expect, it } from 'vitest';
import { draftTakesAnswer, shareUnchanged } from '../src/renderer/src/draftAnswer';
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

// The answer comes over IPC, so every object in it is new. An editor that keeps its own text (a table
// cell) follows its value by identity, so the parts of the draft whose content didn't change keep theirs.
describe('shareUnchanged', () => {
  it('keeps the draft’s own objects wherever the answer holds the same content', () => {
    const draft = {
      id: 'p1',
      updatedAt: 1,
      settings: { platform: 'ios', simulators: [{ name: 'iPhone 15', sdk: '' }], streaming: { androidH264: true } },
      env: {}
    };
    const answer = structuredClone({ ...draft, updatedAt: 2 });
    const shared = shareUnchanged(draft, answer);
    expect(shared).toEqual(answer);
    expect(shared).not.toBe(draft);
    expect(shared.settings).toBe(draft.settings);
    expect(shared.settings.simulators).toBe(draft.settings.simulators);
    expect(shared.env).toBe(draft.env);
  });

  it('takes the answer’s parts that changed, and keeps the unchanged ones beside them', () => {
    const draft = {
      settings: { proxy: { host: 'squid.lab', auth: { username: 'qa', password: 'p-test-1' } }, simulators: [{ name: 'a' }] },
      secretRefs: [] as string[]
    };
    const answer = { settings: { proxy: { host: 'squid.lab', auth: { username: 'qa' } }, simulators: [{ name: 'a' }] }, secretRefs: ['PROXY_PASSWORD'] };
    const shared = shareUnchanged(draft, answer);
    expect(shared).toEqual(answer);
    expect(shared.settings.simulators).toBe(draft.settings.simulators);
    expect(shared.settings.proxy).not.toBe(draft.settings.proxy);
    expect('password' in shared.settings.proxy.auth).toBe(false);
  });

  it('returns the draft itself when nothing differs, and the answer’s values where the shapes differ', () => {
    const draft = { a: [1, 2], b: { c: 'x' } };
    expect(shareUnchanged(draft, structuredClone(draft))).toBe(draft);
    expect(shareUnchanged({ a: [1, 2] }, { a: [1, 2, 3] })).toEqual({ a: [1, 2, 3] });
    expect(shareUnchanged({ a: { b: 1 } }, { a: [1] })).toEqual({ a: [1] });
    expect(shareUnchanged({ a: 1, gone: true }, { a: 1 })).toEqual({ a: 1 });
    expect(shareUnchanged(null, { a: 1 })).toEqual({ a: 1 });
  });
});
