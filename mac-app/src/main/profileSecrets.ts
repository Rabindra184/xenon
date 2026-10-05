import type { Profile, SecretKey } from '@shared/types';
import { SECRET_SETTINGS, isSecretKey, secretForEnvName } from '@shared/secrets';

// A profile is plain JSON on disk and goes whole into an export, so a secret
// value belongs in the Keychain (SecretsStore), never in a profile. Profiles
// held them in two places: a secret-bearing setting (the Database URL field
// Settings used to show, or an AI key in an imported profile), which the launch
// never passed to the server, and an environment variable named like a secret
// (DATABASE_URL under Environment variables), which it did.

/** The part of SecretsStore the move uses. `set` throws when the Keychain is unavailable. */
export interface SecretVault {
  has(key: SecretKey): boolean;
  reveal(key: SecretKey): string | null;
  set(key: SecretKey, value: string): void;
}

type Slot = { kind: 'empty' } | { kind: 'unreadable' } | { kind: 'value'; value: string };

// An imported profile can hold anything in these fields. The launch iterates
// `secretRefs` (a string injects nothing; an object throws), so anything but an
// array injects nothing here either.
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const refsOf = (p: Profile): SecretKey[] => (isRecord(p) && Array.isArray(p.secretRefs) ? p.secretRefs : []);
const envOf = (p: Profile): Record<string, unknown> => (isRecord(p) && isRecord(p.env) ? p.env : {});
const settingsOf = (p: Profile): Record<string, unknown> => (isRecord(p) && isRecord(p.settings) ? p.settings : {});

function slotOf(vault: SecretVault, key: SecretKey): Slot {
  const value = vault.reveal(key);
  if (value !== null) return { kind: 'value', value };
  return vault.has(key) ? { kind: 'unreadable' } : { kind: 'empty' };
}

function withoutSetting(profile: Profile, setting: string): Profile {
  const settings = { ...settingsOf(profile) };
  delete settings[setting];
  return { ...profile, settings };
}

/** The env var gone, and the secret of the same name injected in its place. */
function injectedInsteadOfEnv(profile: Profile, key: SecretKey): Profile {
  const env = { ...envOf(profile) } as Record<string, string>;
  delete env[key];
  const refs = refsOf(profile);
  return { ...profile, env, secretRefs: refs.includes(key) ? refs : [...refs, key] };
}

/**
 * Moves the secret values profiles hold in plain text into the Keychain,
 * without changing what any profile's launch passes to the server:
 *
 * - An environment variable named like a secret was passed at launch. It moves
 *   when the Keychain holds no value for it or the same one, and the profile
 *   then injects the secret, so the server gets the same value. One that the
 *   profile's injected secret already overrides is dropped. Otherwise (another
 *   value stored, not injected) it stays: moving it would change, say, which
 *   database the server opens.
 * - A secret-bearing setting was never passed. It moves into an empty Keychain
 *   slot without being injected, since turning it on now would open another
 *   database than the one in use, and is dropped when the Keychain already
 *   holds a value.
 *
 * Every profile's env vars go before any setting, so a value that was never
 * used can't take a slot ahead of one in use. A value is stored only into an
 * empty slot, and only when no profile would start receiving it: every profile
 * that injects that secret must already pass the same value. A stored value
 * that can't be read is never overwritten, and with the Keychain unavailable
 * everything stays where it is. Only a secret's own name moves: an older name
 * Xenon also reads (OPENAI_API_KEY) would reach the server under another name.
 * Profiles are never mutated; an unchanged one is returned as given.
 */
export function moveSecretsToKeychain(input: Profile[], vault: SecretVault): { profiles: Profile[]; changed: boolean } {
  const profiles = [...input];
  let changed = false;

  // Secrets are app-wide, and a profile injecting one that isn't stored gets
  // nothing (or its env var). Storing a value is safe only if every profile
  // injecting it passes that value already.
  const safeToStore = (key: SecretKey, value: string): boolean =>
    profiles.every((p) => !refsOf(p).includes(key) || envOf(p)[key] === value);
  const store = (key: SecretKey, value: string): boolean => {
    try {
      vault.set(key, value);
      return true;
    } catch {
      return false;
    }
  };

  // The env vars first: they were in use, so they decide what a slot holds.
  for (let i = 0; i < profiles.length; i++) {
    for (const [name, value] of Object.entries(envOf(profiles[i]))) {
      if (!isSecretKey(name) || typeof value !== 'string' || value === '') continue;
      const slot = slotOf(vault, name);
      const overridden = slot.kind === 'value' && refsOf(profiles[i]).includes(name);
      const same = slot.kind === 'value' && slot.value === value;
      const stored = slot.kind === 'empty' && safeToStore(name, value) && store(name, value);
      if (!overridden && !same && !stored) continue;
      profiles[i] = injectedInsteadOfEnv(profiles[i], name);
      changed = true;
    }
  }

  for (let i = 0; i < profiles.length; i++) {
    for (const [setting, key] of Object.entries(SECRET_SETTINGS)) {
      const settings = settingsOf(profiles[i]);
      if (!Object.prototype.hasOwnProperty.call(settings, setting)) continue;
      const value = settings[setting];
      if (typeof value === 'string' && value !== '') {
        const slot = slotOf(vault, key);
        const kept = slot.kind === 'value' || (slot.kind === 'empty' && safeToStore(key, value) && store(key, value));
        if (!kept) continue;
      } else if (value !== undefined && value !== null && value !== '') {
        continue; // not a string, so not a value the Keychain could hold
      }
      profiles[i] = withoutSetting(profiles[i], setting);
      changed = true;
    }
  }
  return { profiles, changed };
}

/**
 * The profile without any secret value: no secret-bearing setting, and no env
 * var named like a secret, by its own name or an older one Xenon also reads.
 */
export function withoutSecrets(profile: Profile): Profile {
  const settings = { ...settingsOf(profile) };
  for (const setting of Object.keys(SECRET_SETTINGS)) delete settings[setting];
  const env = Object.fromEntries(
    Object.entries(envOf(profile)).filter(([name]) => secretForEnvName(name) === null)
  ) as Record<string, string>;
  return { ...profile, settings, env };
}

/** A profile's export. It names the secrets the profile injects (`secretRefs`) and carries none of their values. */
export function profileExportJson(profile: Profile): string {
  return JSON.stringify({ type: 'xenon-control-profile', version: 1, profile: withoutSecrets(profile) }, null, 2);
}
