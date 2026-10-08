// Which Keychain secrets Keys & accounts lists, and in what order. Pure, so
// the rule is unit-tested; the words are in copy/keys.ts.

import type { Profile, SecretKey } from '@shared/types';
import { isProfileSecret } from '@shared/secrets';

/** Every Keychain secret, in the order Keys & accounts lists them. */
export const KEY_ORDER: readonly SecretKey[] = [
  'XENON_GEMINI_API_KEY',
  'XENON_OPENAI_API_KEY',
  'XENON_ANTHROPIC_API_KEY',
  'XENON_HUB_ACCESS_KEY',
  'XENON_HUB_TOKEN',
  'XENON_SMTP_URL',
  'CLOUD_KEY',
  'PROXY_PASSWORD',
  'DATABASE_URL'
];

/** Secrets only technical details list: the database file (R47), whose value is a path. */
const TECHNICAL_ONLY: ReadonlySet<SecretKey> = new Set<SecretKey>(['DATABASE_URL']);

/** The secrets Keys & accounts lists now, in order. */
export function keyRows(technical: boolean): SecretKey[] {
  return KEY_ORDER.filter((key) => technical || !TECHNICAL_ONLY.has(key));
}

/**
 * The names of the other profiles that use an app-wide secret (it is in their
 * `secretRefs`), in the order the profiles are listed: saving a new value
 * changes it for them too. None for a profile's own secret (R54), which no
 * other profile ever uses.
 */
export function alsoUsedBy(key: SecretKey, openId: string, profiles: readonly Profile[]): string[] {
  if (isProfileSecret(key)) return [];
  return profiles
    .filter((p) => p.id !== openId && Array.isArray(p.secretRefs) && p.secretRefs.includes(key))
    .map((p) => p.name);
}
