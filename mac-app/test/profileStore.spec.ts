import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLaunchPlan } from '../src/main/LaunchBuilder';
import { ProfileStore } from '../src/main/ProfileStore';
import { launchSecrets, type SecretVault } from '../src/main/profileSecrets';
import type { Profile } from '../src/shared/types';

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

const vault: SecretVault = { has: () => false, reveal: () => null, set: () => undefined, clear: () => undefined };

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

/** SecretsStore's behaviour, in memory, by slot, recording every value it is asked to store. */
function memoryVault(values: Record<string, string> = {}) {
  const stores: [string, string][] = [];
  const vault: SecretVault = {
    has: (slot) => slot in values,
    reveal: (slot) => values[slot] ?? null,
    set: (slot, value) => {
      stores.push([slot, value]);
      values[slot] = value;
    },
    clear: (slot) => {
      delete values[slot];
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
    // The cloud key and the proxy password are the profile's own (R54); the AI key is app-wide.
    expect(values).toEqual({ 'CLOUD_KEY@p1': CLOUD_KEY, 'PROXY_PASSWORD@p1': PROXY_PASSWORD, XENON_GEMINI_API_KEY: GEMINI_KEY });
    // The profile as stored comes back, so the renderer's list shows it.
    expect(saved.secretRefs).toEqual([]);
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
    expect(values).toEqual({
      'CLOUD_KEY@p1': CLOUD_KEY,
      'PROXY_PASSWORD@p1': PROXY_PASSWORD,
      XENON_GEMINI_API_KEY: GEMINI_KEY,
      DATABASE_URL: 'file:/x.db'
    });
    expect(fileText()).not.toMatch(/k-test-123|p@ss|g-test-123|file:\/x\.db/);

    // The renderer's save, made before it heard of the move, carries every value again.
    const stale = { ...withSecrets, name: 'Lab renamed', env: { DATABASE_URL: 'file:/x.db' } };
    const saved = store.save(stale);
    expect(fileText()).not.toMatch(/k-test-123|p@ss|g-test-123|file:\/x\.db/);
    expect(saved.name).toBe('Lab renamed');
    expect(saved.env).toEqual({});
    expect(saved.secretRefs).toEqual(['DATABASE_URL']);
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
    expect(values).toEqual({ 'CLOUD_KEY@p1': 'k-abc-full' });
  });

  it('replaces the profile’s own proxy password with a new one its proxy settings carry (R54)', () => {
    const { vault, values } = memoryVault();
    const store = new ProfileStore(vault);
    const first = store.save(profileWith({ settings: { platform: 'android', proxy: { host: 'squid.lab', auth: { username: 'qa', password: 'p-old' } } } }));
    // The window took the answer, and the person typed a new password into the proxy settings.
    store.save({ ...first, settings: { ...first.settings, proxy: { host: 'squid.lab', auth: { username: 'qa', password: 'p-new' } } } });
    expect(values).toEqual({ 'PROXY_PASSWORD@p1': 'p-new' });
    expect(fileText()).not.toMatch(/p-old|p-new/);
  });

  it('changes no other profile when it saves one', () => {
    const other = profileWith({ id: 'other', name: 'Other', env: { DATABASE_URL: 'file:/x.db' }, settings: { platform: 'android', cloud: { apiKey: 'k-other-456' } } });
    writeFileSync(join(folder.path, 'profiles.json'), JSON.stringify({ profiles: [other] }));
    const { vault, values } = memoryVault();
    new ProfileStore(vault).save(profileWith({ settings: { platform: 'android', proxy: { host: 'squid.lab', auth: { username: 'qa', password: PROXY_PASSWORD } } } }));
    expect(JSON.parse(fileText()).profiles.find((p: Profile) => p.id === 'other')).toEqual(other);
    expect(values).toEqual({ 'PROXY_PASSWORD@p1': PROXY_PASSWORD });
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

  it('moves the key a profile it imports carries into the new profile’s own slot, and touches no other (R54)', () => {
    const { vault, values } = memoryVault({ 'CLOUD_KEY@p1': 'k-other-456' });
    const store = new ProfileStore(vault);
    const [imported] = store.importFrom({
      profile: profileWith({ secretRefs: ['CLOUD_KEY'], settings: { platform: 'android', cloud: { cloudName: 'x', apiKey: CLOUD_KEY } } })
    });
    expect(imported.id).not.toBe('p1');
    expect(values).toEqual({ 'CLOUD_KEY@p1': 'k-other-456', [`CLOUD_KEY@${imported.id}`]: CLOUD_KEY });
    expect(imported.secretRefs).toEqual([]);
    expect(fileText()).not.toContain(CLOUD_KEY);
  });

  it('keeps a value it could not move, and still saves, when the Keychain is unavailable', () => {
    const vault: SecretVault = {
      has: () => false,
      reveal: () => null,
      set: () => {
        throw new Error('OS encryption (Keychain) is unavailable');
      },
      clear: () => undefined
    };
    const store = new ProfileStore(vault);
    const saved = store.save(withSecrets);
    expect(saved.secretRefs).toEqual([]);
    expect(store.list().map((p) => p.id)).toEqual(['p1']);
  });

  it('moves the secrets of a profile it imports, and gives one it duplicates a copy of its own', () => {
    const { vault, values } = memoryVault();
    const store = new ProfileStore(vault);
    const [imported] = store.importFrom({ type: 'xenon-control-profile', version: 1, profile: withSecrets });
    expect(values[`CLOUD_KEY@${imported.id}`]).toBe(CLOUD_KEY);
    expect(values[`PROXY_PASSWORD@${imported.id}`]).toBe(PROXY_PASSWORD);
    const copy = store.duplicate(imported.id)!;
    expect(values[`CLOUD_KEY@${copy.id}`]).toBe(CLOUD_KEY);
    expect(values[`PROXY_PASSWORD@${copy.id}`]).toBe(PROXY_PASSWORD);
    expect(fileText()).not.toMatch(/k-test-123|p@ss|g-test-123/);
  });
});

/** What a launch of the stored profile passes to the server, as index.ts builds it. */
function launchEnv(profile: Profile, vault: SecretVault): Record<string, string> {
  return buildLaunchPlan(profile, { appiumHome: '/ah', configYamlPath: '/c.yaml', secretValues: launchSecrets(profile, vault) }).env;
}

/** A 0.2.0 profile on a cloud provider behind a proxy, holding its key and password in plain text. */
function oldProfile(id: string, cloudName: string, key: string, password: string): Profile {
  return profileWith({
    id,
    name: id,
    settings: {
      platform: 'android',
      cloud: { cloudName, url: `https://hub.${cloudName}.example/wd/hub`, username: `qa-${id}`, apiKey: key },
      proxy: { host: `proxy-${id}.lab`, port: 3128, auth: { username: 'qa', password } }
    }
  });
}

describe('ProfileStore: each profile keeps its own cloud key and proxy password (R54, C1)', () => {
  beforeEach(() => {
    folder.path = mkdtempSync(join(tmpdir(), 'xenon-profiles-'));
  });

  afterEach(() => {
    rmSync(folder.path, { recursive: true, force: true });
  });

  const fileText = () => readFileSync(join(folder.path, 'profiles.json'), 'utf8');
  const stored = (store: ProfileStore, id: string) => store.list().find((p) => p.id === id)!;

  /** Two 0.2.0 profiles: A on BrowserStack, B on LambdaTest, each behind its own proxy. */
  function twoOldProfiles() {
    const a = oldProfile('A', 'browserstack', 'k-test-A', 'p-test-A');
    const b = oldProfile('B', 'lambdatest', 'k-test-B', 'p-test-B');
    writeFileSync(join(folder.path, 'profiles.json'), JSON.stringify({ profiles: [a, b] }));
    const { vault, values } = memoryVault();
    const store = new ProfileStore(vault);
    store.list();
    return { vault, values, store };
  }

  it('moves each profile’s key and password into its own slots on the first load', () => {
    const { vault, values, store } = twoOldProfiles();
    expect(values).toEqual({
      'CLOUD_KEY@A': 'k-test-A',
      'PROXY_PASSWORD@A': 'p-test-A',
      'CLOUD_KEY@B': 'k-test-B',
      'PROXY_PASSWORD@B': 'p-test-B'
    });
    expect(fileText()).not.toMatch(/k-test-|p-test-/);
    expect(launchEnv(stored(store, 'A'), vault)).toMatchObject({ CLOUD_KEY: 'k-test-A', HTTP_PROXY: 'http://qa:p-test-A@proxy-A.lab:3128' });
    expect(launchEnv(stored(store, 'B'), vault)).toMatchObject({ CLOUD_KEY: 'k-test-B', HTTP_PROXY: 'http://qa:p-test-B@proxy-B.lab:3128' });
  });

  it('the C1 probe: deleting A leaves B its own key and password, and B launches with them', () => {
    const { vault, values, store } = twoOldProfiles();
    store.delete('A');
    const b = stored(store, 'B');
    expect(values).toEqual({ 'CLOUD_KEY@B': 'k-test-B', 'PROXY_PASSWORD@B': 'p-test-B' });
    const env = launchEnv(b, vault);
    expect(env.CLOUD_KEY).toBe('k-test-B');
    expect(env.HTTP_PROXY).toBe('http://qa:p-test-B@proxy-B.lab:3128');
    expect(JSON.stringify(env)).not.toMatch(/k-test-A|p-test-A/);
    // Listed again, B is as it was.
    expect(launchEnv(stored(store, 'B'), vault)).toMatchObject({ CLOUD_KEY: 'k-test-B' });
  });

  it('never changes B’s key or password when A is saved with new ones, or B is saved with an unrelated edit', () => {
    const { vault, values, store } = twoOldProfiles();
    const a = stored(store, 'A');
    store.save({
      ...a,
      settings: { ...a.settings, proxy: { host: 'proxy-A.lab', port: 3128, auth: { username: 'qa', password: 'p-test-A2' } } }
    });
    store.save({ ...stored(store, 'B'), name: 'B renamed' });
    expect(values).toEqual({
      'CLOUD_KEY@A': 'k-test-A',
      'PROXY_PASSWORD@A': 'p-test-A2',
      'CLOUD_KEY@B': 'k-test-B',
      'PROXY_PASSWORD@B': 'p-test-B'
    });
    expect(launchEnv(stored(store, 'B'), vault).HTTP_PROXY).toBe('http://qa:p-test-B@proxy-B.lab:3128');
  });

  it('launches two profiles with different proxies, each with its own password', () => {
    const { vault, store } = twoOldProfiles();
    expect(launchEnv(stored(store, 'A'), vault).HTTPS_PROXY).toBe('http://qa:p-test-A@proxy-A.lab:3128');
    expect(launchEnv(stored(store, 'B'), vault).HTTPS_PROXY).toBe('http://qa:p-test-B@proxy-B.lab:3128');
  });

  it('gives a duplicate a copy of the key and password, and deleting either leaves the other’s', () => {
    const { vault, values, store } = twoOldProfiles();
    const copy = store.duplicate('B')!;
    expect(values[`CLOUD_KEY@${copy.id}`]).toBe('k-test-B');
    expect(values[`PROXY_PASSWORD@${copy.id}`]).toBe('p-test-B');
    expect(launchEnv(copy, vault)).toMatchObject({ CLOUD_KEY: 'k-test-B', HTTP_PROXY: 'http://qa:p-test-B@proxy-B.lab:3128' });
    store.delete(copy.id);
    expect(`CLOUD_KEY@${copy.id}` in values).toBe(false);
    expect(values['CLOUD_KEY@B']).toBe('k-test-B');
  });

  it('clears only the deleted profile’s own slots, and leaves the app-wide secrets', () => {
    const { values, store } = twoOldProfiles();
    values.XENON_HUB_TOKEN = 't-test-1';
    store.delete('B');
    expect(values).toEqual({ 'CLOUD_KEY@A': 'k-test-A', 'PROXY_PASSWORD@A': 'p-test-A', XENON_HUB_TOKEN: 't-test-1' });
  });

  it('moves a development build’s app-wide key and password into the profiles that used them, then clears them', () => {
    const a = profileWith({ id: 'A', secretRefs: ['CLOUD_KEY', 'PROXY_PASSWORD'], settings: oldProfile('A', 'x', '', '').settings });
    const b = profileWith({ id: 'B', secretRefs: [] });
    writeFileSync(join(folder.path, 'profiles.json'), JSON.stringify({ profiles: [a, b] }));
    const { vault, values } = memoryVault({ CLOUD_KEY: 'k-dev-1', PROXY_PASSWORD: 'p-dev-1' });
    const store = new ProfileStore(vault);
    const listed = store.list();
    expect(values).toEqual({ 'CLOUD_KEY@A': 'k-dev-1', 'PROXY_PASSWORD@A': 'p-dev-1' });
    expect(listed.map((p) => p.secretRefs)).toEqual([[], []]);
    expect(launchEnv(listed[0], vault)).toMatchObject({ CLOUD_KEY: 'k-dev-1', HTTP_PROXY: 'http://qa:p-dev-1@proxy-A.lab:3128' });
    expect('CLOUD_KEY' in launchEnv(listed[1], vault)).toBe(false);
  });
});
