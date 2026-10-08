import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { Profile } from '@shared/types';
import { SEED_PROFILE_NAME, makeDefaultProfile, migrateProfile } from '@shared/profileDefaults';
import {
  clearProfileSecrets,
  copyProfileSecrets,
  moveSecretsOnSave,
  moveSecretsToKeychain,
  profileExport,
  type SecretVault
} from './profileSecrets';

// Named launch profiles persisted as JSON in userData. Profiles never hold raw
// secrets — only `secretRefs` naming which app-wide secrets to inject at
// launch. A profile's own cloud key and proxy password are in its own Keychain
// slots (R54): deleting the profile clears them, and a duplicate gets a copy.
// One saved by an older version (a Database URL in its settings, DATABASE_URL
// among its env vars, a cloud key or a proxy password) has the value moved into
// the Keychain when profiles are listed or imported, and a profile saved or
// started holding one has it moved before it is written.
interface ProfilesShape {
  profiles: Profile[];
  /**
   * The profile the window had open last, on this Mac. Closing the window ends
   * the page that knew, and the menu-bar icon's Start reopens it: it opens this
   * one again, as does the next launch.
   */
  openId?: string;
}

export function defaultProfile(name = SEED_PROFILE_NAME): Profile {
  return makeDefaultProfile({ id: randomUUID(), now: Date.now(), name });
}

export class ProfileStore {
  private store = new Store<ProfilesShape>({
    name: 'profiles',
    defaults: { profiles: [] }
  });

  constructor(private readonly secrets: SecretVault) {}

  list(): Profile[] {
    const stored = this.store.get('profiles');
    if (stored.length === 0) {
      // Seed a sensible starter profile on first run so the UI is never empty.
      const seed = defaultProfile();
      this.store.set('profiles', [seed]);
      return [seed];
    }
    // Listing runs at startup, after an import and after a delete. A new value
    // is stored from an env var here, on an import and at a start, never on a
    // save: the renderer saves while someone types, and storing DATABASE_URL
    // then would keep its first letters (moveSecretsOnSave).
    let profiles = stored;
    try {
      const moved = moveSecretsToKeychain(stored, this.secrets);
      if (moved.changed) this.store.set('profiles', moved.profiles);
      profiles = moved.profiles;
    } catch (err) {
      // The launcher must always list its profiles; the move is tried again next time.
      // eslint-disable-next-line no-console
      console.error('[Xenon Control] could not move secret values out of the profiles:', err);
    }
    return profiles.map(migrateProfile);
  }

  /**
   * Writes the profile and returns it as stored. A secret value it holds moves
   * into the Keychain first (moveSecretsOnSave), so no save writes one: the
   * window can send a save made before main moved a value, which still holds
   * it. Only this profile changes. An env var's value typed a few letters per
   * save is only stored when the profile starts (saveToStart) or at the next
   * listing.
   */
  save(profile: Profile): Profile {
    return this.put({ ...profile, updatedAt: Date.now() }, (profiles, idx) => {
      const others = profiles.filter((_, i) => i !== idx);
      profiles[idx] = moveSecretsOnSave(profiles[idx], others, this.secrets);
      return profiles;
    });
  }

  /**
   * Saves the profile about to start and moves all its secret values as a
   * listing does: what it holds is final by then, so a value typed into an env
   * var is stored and injected too.
   */
  saveToStart(profile: Profile): Profile {
    const saved = this.save(profile);
    return this.put(saved, (profiles) => moveSecretsToKeychain(profiles, this.secrets, { only: saved.id }).profiles);
  }

  /**
   * Puts the profile in place of the stored one with its id (or adds it), lets
   * `move` take the secret values out, writes the profiles and returns this one
   * as stored. A move that throws is logged and the profile written as it is:
   * a save must always be written, and the move is tried again next time.
   */
  private put(profile: Profile, move: (profiles: Profile[], idx: number) => Profile[]): Profile {
    const profiles = [...this.store.get('profiles')];
    let idx = profiles.findIndex((p) => p.id === profile.id);
    if (idx === -1) {
      idx = profiles.length;
      profiles.push(profile);
    } else {
      profiles[idx] = profile;
    }
    let written = profiles;
    try {
      written = move([...profiles], idx);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Xenon Control] could not move secret values out of a saved profile:', err);
    }
    this.store.set('profiles', written);
    return written[idx];
  }

  /** Deletes the profile, and its own cloud key and proxy password with it: no other profile ever uses them. */
  delete(id: string): void {
    this.store.set(
      'profiles',
      this.store.get('profiles').filter((p) => p.id !== id)
    );
    try {
      clearProfileSecrets(this.secrets, id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Xenon Control] could not clear a deleted profile’s own secrets:', err);
    }
  }

  /** A copy of the profile, with a copy of its own cloud key and proxy password in the copy's own slots. */
  duplicate(id: string): Profile | null {
    const source = this.store.get('profiles').find((p) => p.id === id);
    if (!source) return null;
    const now = Date.now();
    const copy: Profile = {
      ...structuredClone(source),
      id: randomUUID(),
      name: `${source.name} (copy)`,
      createdAt: now,
      updatedAt: now
    };
    try {
      copyProfileSecrets(this.secrets, source.id, copy.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Xenon Control] could not copy a profile’s own secrets to its duplicate:', err);
    }
    return this.save(copy);
  }

  /** The profile the window had open last, or null. It may have been deleted since; the window checks. */
  openId(): string | null {
    const id = this.store.get('openId');
    return typeof id === 'string' ? id : null;
  }

  /** Remembers the profile the window has open; null when it has none. */
  setOpenId(id: string | null): void {
    if (id === null) this.store.delete('openId');
    else this.store.set('openId', id);
  }

  get(id: string): Profile | null {
    const found = this.store.get('profiles').find((p) => p.id === id);
    return found ? migrateProfile(found) : null;
  }

  /**
   * A profile for sharing: the file's text, which contains no secret values —
   * only secretRefs names — and the names of what it left out.
   */
  exportData(id: string): { json: string; leftOut: string[] } | null {
    const profile = this.get(id);
    return profile ? profileExport(profile) : null;
  }

  /**
   * Import one or more profiles from parsed JSON (a single profile, an array, or
   * an exported wrapper). Each gets a fresh id so imports never collide. Their
   * secret values move as when listing: a value already in the Keychain wins
   * over one a file brings, which no one just typed.
   */
  importFrom(parsed: unknown): Profile[] {
    const candidates: unknown[] = [];
    if (Array.isArray(parsed)) candidates.push(...parsed);
    else if (parsed && typeof parsed === 'object' && 'profile' in (parsed as object))
      candidates.push((parsed as { profile: unknown }).profile);
    else candidates.push(parsed);

    const imported: Profile[] = [];
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      const src = c as Partial<Profile>;
      if (!src.settings || !src.server) continue; // not a profile
      const now = Date.now();
      const profile: Profile = migrateProfile({
        ...defaultProfile(src.name || 'Imported profile'),
        ...src,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
      } as Profile);
      imported.push(this.put(profile, (profiles) => moveSecretsToKeychain(profiles, this.secrets, { only: profile.id }).profiles));
    }
    return imported;
  }
}
