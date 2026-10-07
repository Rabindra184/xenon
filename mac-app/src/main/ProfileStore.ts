import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { Profile } from '@shared/types';
import { SEED_PROFILE_NAME, makeDefaultProfile, migrateProfile } from '@shared/profileDefaults';
import { moveSecretsToKeychain, profileExport, type SecretVault } from './profileSecrets';

// Named launch profiles persisted as JSON in userData. Profiles never hold raw
// secrets — only `secretRefs` naming which secrets to inject at launch. One
// saved by an older version (a Database URL in its settings, DATABASE_URL among
// its env vars) has the value moved into the Keychain when profiles are listed.
interface ProfilesShape {
  profiles: Profile[];
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
    // Listing runs at startup and after an import, and not on save: the
    // renderer saves while someone types, and moving DATABASE_URL out of the
    // env vars then would take the row away mid-word.
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

  save(profile: Profile): Profile {
    const profiles = this.store.get('profiles');
    const updated: Profile = { ...profile, updatedAt: Date.now() };
    const idx = profiles.findIndex((p) => p.id === profile.id);
    if (idx === -1) {
      profiles.push(updated);
    } else {
      profiles[idx] = updated;
    }
    this.store.set('profiles', profiles);
    return updated;
  }

  delete(id: string): void {
    this.store.set(
      'profiles',
      this.store.get('profiles').filter((p) => p.id !== id)
    );
  }

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
    return this.save(copy);
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
   * an exported wrapper). Each gets a fresh id so imports never collide.
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
      imported.push(this.save(profile));
    }
    return imported;
  }
}
