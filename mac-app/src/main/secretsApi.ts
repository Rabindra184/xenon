import type { SecretKey, SecretSaveResult, SecretSlot, SecretsStatus } from '@shared/types';
import { isProfileSecret, isSecretKey, profileSecretSlot } from '@shared/secrets';
import type { SecretVault } from './profileSecrets';

// What the window may do with the Keychain secrets (the secrets:* calls): save
// one, clear one, and ask which hold a value. It never gets a value back. An
// app-wide secret is one slot for the whole app; a profile's own (the cloud
// key, the proxy password: R54) is the slot of the profile the window names,
// and only of a profile that exists. Anything else the window sends is refused.

export interface SecretsApiDeps {
  /** SecretsStore: its slots, and whether this Mac's Keychain can encrypt now. */
  vault: SecretVault & { readonly available: boolean };
  /** Whether a profile with this id is saved. */
  profileExists(id: string): boolean;
}

/** The slot the window means: an app-wide secret's own, or a saved profile's own one; null for anything else. */
function slotFor(deps: SecretsApiDeps, key: unknown, profileId: unknown): SecretSlot | null {
  if (typeof key !== 'string' || !isSecretKey(key)) return null;
  if (!isProfileSecret(key)) return key;
  if (typeof profileId !== 'string' || profileId === '' || !deps.profileExists(profileId)) return null;
  return profileSecretSlot(key, profileId);
}

/**
 * Whether each secret in `keys` holds a value (a profile's own: the one of the
 * profile `profileId`), and whether that profile's proxy password has a colon
 * in it (R53). Never a value.
 */
export function secretsStatus(deps: SecretsApiDeps, keys: unknown, profileId: unknown): SecretsStatus {
  const saved: Partial<Record<SecretKey, boolean>> = {};
  for (const key of Array.isArray(keys) ? keys : []) {
    if (typeof key !== 'string' || !isSecretKey(key)) continue;
    const slot = slotFor(deps, key, profileId);
    saved[key] = slot !== null && deps.vault.has(slot);
  }
  const proxy = slotFor(deps, 'PROXY_PASSWORD', profileId);
  const password = proxy === null ? null : deps.vault.reveal(proxy);
  return { saved, proxyPasswordHasColon: password !== null && password.includes(':') };
}

/**
 * Saves a value typed in Keys & accounts or Essentials: an app-wide secret in
 * its slot, a profile's own in the slot of `profileId` (the profile the person
 * pressed Save on, R51). Says why when it can't.
 */
export function saveSecret(deps: SecretsApiDeps, key: unknown, value: unknown, profileId: unknown): SecretSaveResult {
  const slot = slotFor(deps, key, profileId);
  if (slot === null || typeof value !== 'string' || value === '') return 'failed';
  if (!deps.vault.available) return 'keychain-unavailable';
  try {
    deps.vault.set(slot, value);
  } catch {
    return deps.vault.available ? 'failed' : 'keychain-unavailable';
  }
  return deps.vault.has(slot) ? 'saved' : 'failed';
}

/** Clears a secret: an app-wide one, or the profile's own. True when the slot is empty now. */
export function clearSecret(deps: SecretsApiDeps, key: unknown, profileId: unknown): boolean {
  const slot = slotFor(deps, key, profileId);
  if (slot === null) return false;
  deps.vault.clear(slot);
  return !deps.vault.has(slot);
}
