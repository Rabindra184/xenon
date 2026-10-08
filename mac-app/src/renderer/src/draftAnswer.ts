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
