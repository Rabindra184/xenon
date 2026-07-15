import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { Profile } from '@shared/types';

// Named launch profiles persisted as JSON in userData. Profiles never hold raw
// secrets — only `secretRefs` naming which secrets to inject at launch.
interface ProfilesShape {
  profiles: Profile[];
}

export function defaultProfile(name = 'Local server'): Profile {
  const now = Date.now();
  return {
    id: randomUUID(),
    name,
    settings: {
      platform: 'both',
      enableDashboard: true,
      maxSessions: 8
    },
    server: {
      port: 4723,
      basePath: '/wd/hub',
      appiumHome: '',
      keepAliveTimeout: 800
    },
    secretRefs: [],
    createdAt: now,
    updatedAt: now
  };
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
    return profiles;
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
    return this.store.get('profiles').find((p) => p.id === id) ?? null;
  }
}
