import type { Profile } from '@shared/types';
import { PROFILES } from './copy/profiles';

/** Which phones a profile is for, in words. Unset is both, as Xenon reads it. */
const PHONES: Record<string, string> = {
  android: 'Android',
  ios: 'iPhone'
};

/** One line that tells profiles apart: which phones, and the port ("Android and iPhone · port 4723"). */
export function profileSummary(p: Profile): string {
  const platform = p.settings.platform;
  // Only the two phones: a plain object also answers to 'constructor' and 'toString'.
  const phones = typeof platform === 'string' && Object.hasOwn(PHONES, platform) ? PHONES[platform] : 'Android and iPhone';
  return `${phones} · port ${p.server.port}`;
}

/**
 * The name a profile is shown by. A profile can have no name (it was cleared,
 * or an imported file held none), and a button or row must still say something,
 * so those are "Untitled profile". The name can be anything in an imported file;
 * only text counts.
 */
export function profileName(name: unknown): string {
  return typeof name === 'string' && name.trim() !== '' ? name : PROFILES.untitled;
}
