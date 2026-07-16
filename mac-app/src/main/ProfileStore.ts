import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { Profile } from '@shared/types';
import { SEED_PROFILE_NAME, makeDefaultProfile } from '@shared/profileDefaults';

// Named launch profiles persisted as JSON in userData. Profiles never hold raw
// secrets — only `secretRefs` naming which secrets to inject at launch.
interface ProfilesShape {
  profiles: Profile[];
}

export function defaultProfile(name = SEED_PROFILE_NAME): Profile {
  return makeDefaultProfile({ id: randomUUID(), now: Date.now(), name });
}

/** Backfill fields added in later versions so older persisted profiles stay valid. */
function migrate(profile: Profile): Profile {
  return { ...profile, env: profile.env ?? {}, secretRefs: profile.secretRefs ?? [] };
}

export class ProfileStore {
  private store = new Store<ProfilesShape>({
    name: 'profiles',
    defaults: { profiles: [] }
  });

  list(): Profile[] {
    const profiles = this.store.get('profiles');
    if (profiles.length === 0) {
      // Seed a sensible starter profile on first run so the UI is never empty.
      const seed = defaultProfile();
      this.store.set('profiles', [seed]);
      return [seed];
    }
    return profiles.map(migrate);
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
    return found ? migrate(found) : null;
  }

  /** Serialize a profile for sharing. Contains no secret values — only secretRefs names. */
  serialize(id: string): string | null {
    const profile = this.get(id);
    if (!profile) return null;
    return JSON.stringify({ type: 'xenon-control-profile', version: 1, profile }, null, 2);
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
      const profile: Profile = migrate({
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
