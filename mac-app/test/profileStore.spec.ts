import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileStore } from '../src/main/ProfileStore';
import type { SecretVault } from '../src/main/profileSecrets';
import type { Profile, SecretKey } from '../src/shared/types';

// electron-store needs Electron to find the userData folder. Its base class,
// conf, does the real reading and writing, so the store runs on that, in a
// throwaway folder, as preferencesStore.spec does.
const folder = vi.hoisted(() => ({ path: '' }));

vi.mock('electron-store', async () => {
  const { default: Conf } = await vi.importActual<{ default: new (options: object) => object }>('conf');
  return {
    default: class extends Conf {
      constructor(options: { name?: string }) {
        super({ ...options, configName: options.name, cwd: folder.path, projectVersion: '0.0.0' });
      }
    }
  };
});

const vault: SecretVault = { has: () => false, reveal: () => null, set: () => undefined };

describe('ProfileStore: the profile the window had open', () => {
  beforeEach(() => {
    folder.path = mkdtempSync(join(tmpdir(), 'xenon-profiles-'));
  });

  afterEach(() => {
    rmSync(folder.path, { recursive: true, force: true });
  });

  it('is none until one is opened', () => {
    expect(new ProfileStore(vault).openId()).toBeNull();
  });

  // A window closed and opened again, or the next launch, is a new store reading the same file.
  it('is remembered on this Mac, across a reopened window and a relaunch', () => {
    new ProfileStore(vault).setOpenId('profile-b');
    expect(new ProfileStore(vault).openId()).toBe('profile-b');
  });

  it('follows the latest profile opened, and can be cleared', () => {
    const store = new ProfileStore(vault);
    store.setOpenId('profile-a');
    store.setOpenId('profile-b');
    expect(new ProfileStore(vault).openId()).toBe('profile-b');
    store.setOpenId(null);
    expect(new ProfileStore(vault).openId()).toBeNull();
  });

  it('never touches the profiles themselves', () => {
    const store = new ProfileStore(vault);
    const before = store.list();
    store.setOpenId('profile-b');
    expect(store.list()).toEqual(before);
  });
});

/** SecretsStore's behaviour, in memory, recording every value it is asked to store. */
function memoryVault(values: Partial<Record<SecretKey, string>> = {}) {
  const stores: [SecretKey, string][] = [];
  const vault: SecretVault = {
    has: (key) => key in values,
    reveal: (key) => values[key] ?? null,
    set: (key, value) => {
      stores.push([key, value]);
      values[key] = value;
    }
  };
  return { vault, values, stores };
}

function profileWith(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Lab',
    settings: { platform: 'android' },
    server: { port: 4799, basePath: '', appiumHome: '', keepAliveTimeout: 600 },
    secretRefs: [],
    env: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

// Fake values only: a real key or password must never reach a test's output.
const CLOUD_KEY = 'k-test-123';
const PROXY_PASSWORD = 'p@ss:w/rd';
const GEMINI_KEY = 'g-test-123';
const withSecrets = profileWith({
  settings: {
    platform: 'android',
    geminiApiKey: GEMINI_KEY,
    cloud: { cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub', apiKey: CLOUD_KEY },
    proxy: { host: 'squid.lab', port: 3128, auth: { username: 'qa', password: PROXY_PASSWORD } }
  }
});

describe('ProfileStore.save: no secret value reaches profiles.json', () => {
  beforeEach(() => {
    folder.path = mkdtempSync(join(tmpdir(), 'xenon-profiles-'));
  });

  afterEach(() => {
    rmSync(folder.path, { recursive: true, force: true });
  });

  const fileText = () => readFileSync(join(folder.path, 'profiles.json'), 'utf8');

  it('moves a cloud key, a proxy password and an AI key into the Keychain, and writes none of them', () => {
    const { vault, values } = memoryVault();
    const store = new ProfileStore(vault);
    const saved = store.save(withSecrets);
    expect(fileText()).not.toMatch(/k-test-123|p@ss|p%40ss|g-test-123/);
    expect(values).toEqual({ CLOUD_KEY, PROXY_PASSWORD, XENON_GEMINI_API_KEY: GEMINI_KEY });
    // The profile as stored comes back, so the renderer's list shows it.
    expect(saved.secretRefs).toEqual(['CLOUD_KEY', 'PROXY_PASSWORD']);
    expect(saved.settings).toEqual({
      platform: 'android',
      cloud: { cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub' },
      proxy: { host: 'squid.lab', port: 3128, auth: { username: 'qa' } }
    });
    expect(JSON.parse(fileText()).profiles).toEqual([saved]);
  });

  it('keeps its return: the profile it was given, with a new time and the same id', () => {
    const store = new ProfileStore(memoryVault().vault);
    const plain = profileWith({ id: 'plain', updatedAt: 1 });
    const saved = store.save(plain);
    expect(saved).toEqual({ ...plain, updatedAt: saved.updatedAt });
    expect(saved.updatedAt).toBeGreaterThan(1);
  });

  it('does not write back a secret main just moved, when a save that was waiting still holds it', () => {
    // An older version wrote the profile with its secrets in it; listing moves them.
    writeFileSync(
      join(folder.path, 'profiles.json'),
      JSON.stringify({ profiles: [{ ...withSecrets, env: { DATABASE_URL: 'file:/x.db' } }] })
    );
    const { vault, values } = memoryVault();
    const store = new ProfileStore(vault);
    store.list();
    expect(values).toEqual({ CLOUD_KEY, PROXY_PASSWORD, XENON_GEMINI_API_KEY: GEMINI_KEY, DATABASE_URL: 'file:/x.db' });
    expect(fileText()).not.toMatch(/k-test-123|p@ss|g-test-123|file:\/x\.db/);

    // The renderer's save, made before it heard of the move, carries every value again.
    const stale = { ...withSecrets, name: 'Lab renamed', env: { DATABASE_URL: 'file:/x.db' } };
    const saved = store.save(stale);
    expect(fileText()).not.toMatch(/k-test-123|p@ss|g-test-123|file:\/x\.db/);
    expect(saved.name).toBe('Lab renamed');
    expect(saved.env).toEqual({});
    expect(saved.secretRefs).toEqual(['DATABASE_URL', 'CLOUD_KEY', 'PROXY_PASSWORD']);
  });

  it('stores nothing while an env var named like a secret is typed, a few letters per save', () => {
    const { vault, stores } = memoryVault();
    const store = new ProfileStore(vault);
    for (const typed of ['f', 'fi', 'fil', 'file:/x.db']) store.save(profileWith({ env: { DATABASE_URL: typed } }));
    expect(stores).toEqual([]);
  });

  it('strips an env var whose value the Keychain already holds, on save', () => {
    const { vault, stores } = memoryVault({ DATABASE_URL: 'file:/x.db' });
    const store = new ProfileStore(vault);
    const saved = store.save(profileWith({ env: { DATABASE_URL: 'file:/x.db', XENON_JWT_ISSUER: 'lab' } }));
    expect(saved.env).toEqual({ XENON_JWT_ISSUER: 'lab' });
    expect(saved.secretRefs).toEqual(['DATABASE_URL']);
    expect(fileText()).not.toContain('file:/x.db');
    expect(stores).toEqual([]);
  });

  it('stores a cloud key typed a few letters per save whole, and never writes any of it (C1)', () => {
    const { vault, values } = memoryVault();
    const store = new ProfileStore(vault);
    for (const typed of ['k-a', 'k-ab', 'k-abc-full']) {
      // A stale window keeps sending the key typed so far, with no CLOUD_KEY injected.
      store.save(profileWith({ settings: { platform: 'android', cloud: { cloudName: 'lambdatest', apiKey: typed } } }));
      expect(fileText()).not.toContain('k-a');
    }
    expect(values).toEqual({ CLOUD_KEY: 'k-abc-full' });
  });

  it('replaces the stored proxy password with a new one the profile’s proxy settings carry (R41)', () => {
    const { vault, values } = memoryVault();
    const store = new ProfileStore(vault);
    const first = store.save(profileWith({ settings: { platform: 'android', proxy: { host: 'squid.lab', auth: { username: 'qa', password: 'p-old' } } } }));
    // The window took the answer, and the person typed a new password into the proxy settings.
    store.save({ ...first, settings: { ...first.settings, proxy: { host: 'squid.lab', auth: { username: 'qa', password: 'p-new' } } } });
    expect(values.PROXY_PASSWORD).toBe('p-new');
    expect(fileText()).not.toMatch(/p-old|p-new/);
  });

  it('changes no other profile when it saves one (R41)', () => {
    const other = profileWith({ id: 'other', name: 'Other', env: { DATABASE_URL: 'file:/x.db' }, settings: { platform: 'android', cloud: { apiKey: 'k-other-456' } } });
    writeFileSync(join(folder.path, 'profiles.json'), JSON.stringify({ profiles: [other] }));
    const { vault, values } = memoryVault();
    new ProfileStore(vault).save(profileWith({ settings: { platform: 'android', proxy: { host: 'squid.lab', auth: { username: 'qa', password: PROXY_PASSWORD } } } }));
    expect(JSON.parse(fileText()).profiles.find((p: Profile) => p.id === 'other')).toEqual(other);
    expect(values).toEqual({ PROXY_PASSWORD });
  });

  it('moves a profile’s env secrets in full when it is started, its values being final by then (R44b)', () => {
    const { vault, values } = memoryVault();
    const store = new ProfileStore(vault);
    const started = store.saveToStart(profileWith({ env: { DATABASE_URL: 'file:/x.db', XENON_JWT_ISSUER: 'lab' } }));
    expect(values).toEqual({ DATABASE_URL: 'file:/x.db' });
    expect(started.env).toEqual({ XENON_JWT_ISSUER: 'lab' });
    expect(started.secretRefs).toEqual(['DATABASE_URL']);
    expect(fileText()).not.toContain('file:/x.db');
  });

  it('lets the Keychain win over a profile it imports, as on load: an import is not someone typing a new key', () => {
    const { vault, values } = memoryVault({ CLOUD_KEY: 'k-other-456' });
    const store = new ProfileStore(vault);
    const [imported] = store.importFrom({ profile: profileWith({ settings: { platform: 'android', cloud: { cloudName: 'x', apiKey: CLOUD_KEY } } }) });
    expect(values.CLOUD_KEY).toBe('k-other-456');
    expect(imported.secretRefs).toEqual(['CLOUD_KEY']);
    expect(fileText()).not.toContain(CLOUD_KEY);
  });

  it('keeps a value it could not move, and still saves, when the Keychain is unavailable', () => {
    const vault: SecretVault = {
      has: () => false,
      reveal: () => null,
      set: () => {
        throw new Error('OS encryption (Keychain) is unavailable');
      }
    };
    const store = new ProfileStore(vault);
    const saved = store.save(withSecrets);
    expect(saved.secretRefs).toEqual([]);
    expect(store.list().map((p) => p.id)).toEqual(['p1']);
  });

  it('moves the secrets of a profile it imports, and of one it duplicates', () => {
    const { vault } = memoryVault();
    const store = new ProfileStore(vault);
    const [imported] = store.importFrom({ type: 'xenon-control-profile', version: 1, profile: withSecrets });
    expect(imported.secretRefs).toEqual(['CLOUD_KEY', 'PROXY_PASSWORD']);
    expect(store.duplicate(imported.id)?.secretRefs).toEqual(['CLOUD_KEY', 'PROXY_PASSWORD']);
    expect(fileText()).not.toMatch(/k-test-123|p@ss|g-test-123/);
  });
});
