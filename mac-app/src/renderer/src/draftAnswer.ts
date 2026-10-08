import type { Profile } from '@shared/types';

/**
 * Whether the open profile's draft takes a save's answer, the profile as main
 * stored it (R40). Main moves secret values out of a save into the Keychain, so
 * a draft that kept them would send them again: a cleared key would come back,
 * and a replaced one would be overwritten with the old. The draft takes the
 * answer only while it is still the very copy that was saved and no edit waits
 * to be saved, so an edit made since is never put back (R17).
 */
export function draftTakesAnswer(draft: Profile | null, sent: Profile, pendingId: string | null): boolean {
  return draft === sent && pendingId === null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `next` with every part whose content equals the same part of `prev` replaced
 * by `prev`'s own object, and `prev` itself when nothing differs. A save's
 * answer comes over IPC, so every object in it is new; an editor that keeps its
 * own text (a table cell) follows its value by identity, and would drop what is
 * being typed if an unchanged part came back as a new object.
 */
export function shareUnchanged<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    const items = next.map((item, i) => shareUnchanged(prev[i], item));
    const same = prev.length === items.length && items.every((item, i) => item === prev[i]);
    return (same ? prev : items) as T;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next);
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = shareUnchanged(prev[key], next[key]);
    const same =
      Object.keys(prev).length === keys.length &&
      keys.every((key) => Object.prototype.hasOwnProperty.call(prev, key) && out[key] === prev[key]);
    return (same ? prev : out) as T;
  }
  return next;
}
