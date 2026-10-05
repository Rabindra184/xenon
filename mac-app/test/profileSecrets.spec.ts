import { describe, expect, it } from 'vitest';
import { buildLaunchPlan } from '../src/main/LaunchBuilder';
import { moveSecretsToKeychain, profileExportJson, type SecretVault } from '../src/main/profileSecrets';
import { SECRET_DESCRIPTORS, SECRET_SETTINGS, isSecretKey, secretForEnvName } from '../src/shared/secrets';
import type { Profile, SecretKey } from '../src/shared/types';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Test',
    settings: { platform: 'android' },
    server: { port: 4723, basePath: '/wd/hub', appiumHome: '', keepAliveTimeout: 800 },
    secretRefs: [],
    env: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

/** SecretsStore's behaviour, in memory. `unreadable` keys exist but can't be decrypted. */
function makeVault(
  values: Partial<Record<SecretKey, string>> = {},
  opts: { unavailable?: boolean; unreadable?: SecretKey[] } = {}
): SecretVault & { values: Partial<Record<SecretKey, string>> } {
  const unreadable = new Set(opts.unreadable ?? []);
  return {
    values,
    has: (key) => key in values || unreadable.has(key),
    reveal: (key) => (unreadable.has(key) ? null : (values[key] ?? null)),
    set: (key, value) => {
      if (opts.unavailable) throw new Error('OS encryption (Keychain) is unavailable');
      values[key] = value;
    }
  };
}

/** What a launch of the profile passes to the server, as index.ts builds it. */
function launchEnv(profile: Profile, vault: SecretVault): Record<string, string> {
  const secretValues: Partial<Record<SecretKey, string>> = {};
  for (const key of profile.secretRefs ?? []) {
    const v = vault.reveal(key);
    if (v) secretValues[key] = v;
  }
  return buildLaunchPlan(profile, { appiumHome: '/ah', configYamlPath: '/c.yaml', secretValues }).env;
}

/** Runs the move and checks that no profile's launch changed, and that a second run changes nothing. */
function moveKeepingLaunches(profiles: Profile[], vault: ReturnType<typeof makeVault>) {
  const before = profiles.map((p) => launchEnv(p, vault));
  const result = moveSecretsToKeychain(profiles, vault);
  expect(result.profiles.map((p) => launchEnv(p, vault))).toEqual(before);
  const stored = { ...vault.values };
  const again = moveSecretsToKeychain(result.profiles, vault);
  expect(again.changed).toBe(false);
  expect(vault.values).toEqual(stored);
  return result;
}

describe('SECRET_SETTINGS', () => {
  it('names a secret the Secrets & Env tab offers for every secret-bearing setting, Database URL included', () => {
    const offered = new Set(SECRET_DESCRIPTORS.map((d) => d.key));
    expect(SECRET_SETTINGS.databaseUrl).toBe('DATABASE_URL');
    for (const key of Object.values(SECRET_SETTINGS)) expect(offered.has(key)).toBe(true);
  });

  it('isSecretKey knows the secrets by their environment variable names', () => {
    expect(isSecretKey('DATABASE_URL')).toBe(true);
    expect(isSecretKey('XENON_HUB_TOKEN')).toBe(true);
    expect(isSecretKey('XENON_JWT_ISSUER')).toBe(false);
    expect(isSecretKey('databaseUrl')).toBe(false);
  });

  it('secretForEnvName also knows the older AI key names Xenon reads', () => {
    expect(secretForEnvName('DATABASE_URL')).toBe('DATABASE_URL');
    expect(secretForEnvName('OPENAI_API_KEY')).toBe('XENON_OPENAI_API_KEY');
    expect(secretForEnvName('GEMINI_API_KEY')).toBe('XENON_GEMINI_API_KEY');
    expect(secretForEnvName('ANTHROPIC_API_KEY')).toBe('XENON_ANTHROPIC_API_KEY');
    expect(secretForEnvName('XENON_JWT_ISSUER')).toBeNull();
    expect(secretForEnvName('constructor')).toBeNull();
  });
});

describe('moveSecretsToKeychain: a value typed in Settings', () => {
  it('moves a Database URL into the Keychain and out of the profile, without turning it on', () => {
    // The launch never passed it, so injecting it now would open another database.
    const vault = makeVault();
    const p = makeProfile({ settings: { platform: 'android', databaseUrl: 'file:/data/xenon.db' } });
    const { profiles, changed } = moveKeepingLaunches([p], vault);
    expect(changed).toBe(true);
    expect(vault.values.DATABASE_URL).toBe('file:/data/xenon.db');
    expect(profiles[0].settings).toEqual({ platform: 'android' });
    expect(profiles[0].secretRefs).toEqual([]);
  });

  it('moves the AI keys an imported profile carries in its settings the same way', () => {
    const vault = makeVault();
    const p = makeProfile({ settings: { platform: 'android', geminiApiKey: 'g-key', anthropicApiKey: 'a-key' } });
    const { profiles } = moveKeepingLaunches([p], vault);
    expect(vault.values).toEqual({ XENON_GEMINI_API_KEY: 'g-key', XENON_ANTHROPIC_API_KEY: 'a-key' });
    expect(profiles[0].settings).toEqual({ platform: 'android' });
  });

  it('drops it when the Keychain already holds a value, the same or another, and keeps the stored one', () => {
    for (const typed of ['file:/a.db', 'file:/b.db']) {
      const vault = makeVault({ DATABASE_URL: 'file:/a.db' });
      const p = makeProfile({ settings: { platform: 'android', databaseUrl: typed } });
      const { profiles } = moveKeepingLaunches([p], vault);
      expect(vault.values.DATABASE_URL).toBe('file:/a.db');
      expect(profiles[0].settings).toEqual({ platform: 'android' });
    }
  });

  it('leaves it in place when storing it would start passing it to a profile that injects that secret', () => {
    const vault = makeVault();
    const typedIn = makeProfile({ id: 'a', settings: { platform: 'android', databaseUrl: 'file:/x.db' } });
    const injects = makeProfile({ id: 'b', secretRefs: ['DATABASE_URL'] });
    const { profiles, changed } = moveKeepingLaunches([typedIn, injects], vault);
    expect(changed).toBe(false);
    expect(vault.values).toEqual({});
    expect(profiles[0].settings.databaseUrl).toBe('file:/x.db');
  });

  it('removes an empty value', () => {
    const vault = makeVault();
    const { profiles, changed } = moveKeepingLaunches(
      [makeProfile({ settings: { platform: 'android', databaseUrl: '' } })],
      vault
    );
    expect(changed).toBe(true);
    expect(vault.values).toEqual({});
    expect('databaseUrl' in profiles[0].settings).toBe(false);
  });
});

describe('moveSecretsToKeychain: an environment variable named like a secret', () => {
  it('moves it into the Keychain and injects it, so the server gets the same value', () => {
    const vault = makeVault();
    const p = makeProfile({ env: { DATABASE_URL: 'file:/x.db', XENON_JWT_ISSUER: 'lab' } });
    const { profiles, changed } = moveKeepingLaunches([p], vault);
    expect(changed).toBe(true);
    expect(vault.values.DATABASE_URL).toBe('file:/x.db');
    expect(profiles[0].env).toEqual({ XENON_JWT_ISSUER: 'lab' });
    expect(profiles[0].secretRefs).toEqual(['DATABASE_URL']);
  });

  it('injects the stored value instead when it is the same', () => {
    const vault = makeVault({ DATABASE_URL: 'file:/x.db' });
    const p = makeProfile({ env: { DATABASE_URL: 'file:/x.db' } });
    const { profiles } = moveKeepingLaunches([p], vault);
    expect(profiles[0].env).toEqual({});
    expect(profiles[0].secretRefs).toEqual(['DATABASE_URL']);
  });

  it('leaves it when the Keychain holds another value the profile does not inject', () => {
    const vault = makeVault({ DATABASE_URL: 'file:/a.db' });
    const p = makeProfile({ env: { DATABASE_URL: 'file:/b.db' } });
    const { profiles, changed } = moveKeepingLaunches([p], vault);
    expect(changed).toBe(false);
    expect(profiles[0]).toBe(p);
    expect(vault.values.DATABASE_URL).toBe('file:/a.db');
  });

  it('drops it when the profile already injects a stored value, which wins over it', () => {
    const vault = makeVault({ DATABASE_URL: 'file:/a.db' });
    const p = makeProfile({ env: { DATABASE_URL: 'file:/b.db' }, secretRefs: ['DATABASE_URL'] });
    const { profiles } = moveKeepingLaunches([p], vault);
    expect(profiles[0].env).toEqual({});
    expect(profiles[0].secretRefs).toEqual(['DATABASE_URL']);
  });

  it('does not store a value another profile would start receiving', () => {
    const vault = makeVault();
    const mover = makeProfile({ id: 'a', env: { DATABASE_URL: 'file:/x.db' } });
    const injectsNothingYet = makeProfile({ id: 'b', secretRefs: ['DATABASE_URL'] });
    const { changed } = moveKeepingLaunches([mover, injectsNothingYet], vault);
    expect(changed).toBe(false);
    expect(vault.values).toEqual({});
  });

  it('with two profiles on different databases, moves the first and leaves the second its own', () => {
    const vault = makeVault();
    const first = makeProfile({ id: 'a', env: { DATABASE_URL: 'file:/a.db' } });
    const second = makeProfile({ id: 'b', env: { DATABASE_URL: 'file:/b.db' } });
    const { profiles } = moveKeepingLaunches([first, second], vault);
    expect(vault.values.DATABASE_URL).toBe('file:/a.db');
    expect(profiles[0].env).toEqual({});
    expect(profiles[1]).toBe(second);
  });

  it('leaves an empty value alone', () => {
    const vault = makeVault();
    const p = makeProfile({ env: { DATABASE_URL: '' } });
    expect(moveKeepingLaunches([p], vault).changed).toBe(false);
  });
});

describe('moveSecretsToKeychain: across profiles', () => {
  it("never lets one profile's unused Settings value take the slot from another's env var in use", () => {
    const vault = makeVault();
    const typedIn = makeProfile({ id: 'a', settings: { platform: 'android', databaseUrl: 'file:/never-used.db' } });
    const inUse = makeProfile({ id: 'b', env: { DATABASE_URL: 'file:/in-use.db' } });
    const { profiles } = moveKeepingLaunches([typedIn, inUse], vault);
    expect(vault.values.DATABASE_URL).toBe('file:/in-use.db');
    expect(profiles[1].env).toEqual({});
    expect(profiles[1].secretRefs).toEqual(['DATABASE_URL']);
    expect(profiles[0].settings).toEqual({ platform: 'android' });
  });

  it('settles in one run when a profile injecting the secret passes the same value from its env', () => {
    const vault = makeVault();
    const typedIn = makeProfile({ id: 'a', settings: { platform: 'android', databaseUrl: 'file:/a.db' } });
    const injects = makeProfile({ id: 'b', secretRefs: ['DATABASE_URL'], env: { DATABASE_URL: 'file:/b.db' } });
    const { profiles } = moveKeepingLaunches([typedIn, injects], vault);
    expect(vault.values.DATABASE_URL).toBe('file:/b.db');
    expect(profiles[0].settings).toEqual({ platform: 'android' });
  });

  it('leaves an older AI key name in the env: it would reach the server under another name', () => {
    const vault = makeVault();
    const p = makeProfile({ env: { OPENAI_API_KEY: 'sk-1' } });
    const { profiles, changed } = moveKeepingLaunches([p], vault);
    expect(changed).toBe(false);
    expect(profiles[0]).toBe(p);
  });
});

describe('moveSecretsToKeychain: an imported profile with odd fields', () => {
  it('reads a secretRefs that is a string as injecting nothing, as the launch does', () => {
    const vault = makeVault();
    const p = makeProfile({
      env: { DATABASE_URL: 'file:/x.db' },
      secretRefs: 'DATABASE_URL' as unknown as SecretKey[]
    });
    const { profiles } = moveKeepingLaunches([p], vault);
    expect(vault.values.DATABASE_URL).toBe('file:/x.db');
    expect(profiles[0].secretRefs).toEqual(['DATABASE_URL']);
  });

  it('does not throw on a secretRefs, env or settings that is not what a profile holds', () => {
    const vault = makeVault();
    const odd = [
      makeProfile({ id: 'a', secretRefs: { DATABASE_URL: true } as unknown as SecretKey[] }),
      makeProfile({ id: 'b', env: 'DATABASE_URL=file:/x.db' as unknown as Record<string, string> }),
      makeProfile({ id: 'c', settings: 'databaseUrl' as unknown as Profile['settings'] }),
      makeProfile({ id: 'd', env: { DATABASE_URL: 'file:/x.db' } }),
      null as unknown as Profile
    ];
    const { profiles } = moveSecretsToKeychain(odd, vault);
    expect(profiles[0]).toBe(odd[0]);
    expect(profiles[1]).toBe(odd[1]);
    expect(profiles[2]).toBe(odd[2]);
    expect(vault.values.DATABASE_URL).toBe('file:/x.db');
    expect(profiles[3].secretRefs).toEqual(['DATABASE_URL']);
    expect(profiles[4]).toBeNull();
  });
});

describe('moveSecretsToKeychain: what it never does', () => {
  it('never overwrites a stored value it cannot read', () => {
    const vault = makeVault({}, { unreadable: ['DATABASE_URL'] });
    const p = makeProfile({
      settings: { platform: 'android', databaseUrl: 'file:/x.db' },
      env: { DATABASE_URL: 'file:/y.db' }
    });
    const { profiles, changed } = moveKeepingLaunches([p], vault);
    expect(changed).toBe(false);
    expect(profiles[0]).toBe(p);
    expect(vault.values).toEqual({});
  });

  it('keeps every value where it is when the Keychain is unavailable', () => {
    const vault = makeVault({}, { unavailable: true });
    const p = makeProfile({
      settings: { platform: 'android', databaseUrl: 'file:/x.db' },
      env: { DATABASE_URL: 'file:/y.db' }
    });
    const { profiles, changed } = moveKeepingLaunches([p], vault);
    expect(changed).toBe(false);
    expect(profiles[0]).toBe(p);
  });

  it('returns a profile with nothing secret as it was, including one saved before env and secretRefs existed', () => {
    const vault = makeVault({ DATABASE_URL: 'file:/a.db' });
    const old = { ...makeProfile(), env: undefined, secretRefs: undefined } as unknown as Profile;
    const plain = makeProfile({ id: 'p2', env: { XENON_JWT_ISSUER: 'lab' } });
    const { profiles, changed } = moveSecretsToKeychain([old, plain], vault);
    expect(changed).toBe(false);
    expect(profiles[0]).toBe(old);
    expect(profiles[1]).toBe(plain);
  });

  it('does not change the profiles it is given', () => {
    const vault = makeVault();
    const p = makeProfile({
      settings: { platform: 'android', databaseUrl: 'file:/x.db' },
      env: { DATABASE_URL: 'file:/x.db' }
    });
    const copy = structuredClone(p);
    moveSecretsToKeychain([p], vault);
    expect(p).toEqual(copy);
  });
});

describe('profileExportJson', () => {
  it('carries no Database URL or other secret, from settings or from environment variables', () => {
    const p = makeProfile({
      settings: { platform: 'android', databaseUrl: 'file:/x.db', geminiApiKey: 'g-key', maxSessions: 2 },
      env: { DATABASE_URL: 'file:/y.db', XENON_HUB_TOKEN: 't', OPENAI_API_KEY: 'sk-1', XENON_JWT_ISSUER: 'lab' },
      secretRefs: ['DATABASE_URL']
    });
    const json = profileExportJson(p);
    expect(json).not.toMatch(/file:\/|g-key|sk-1|databaseUrl|geminiApiKey|XENON_HUB_TOKEN|OPENAI_API_KEY/);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('xenon-control-profile');
    expect(parsed.version).toBe(1);
    expect(parsed.profile.settings).toEqual({ platform: 'android', maxSessions: 2 });
    expect(parsed.profile.env).toEqual({ XENON_JWT_ISSUER: 'lab' });
    // Which secrets the profile injects is a name, not a value, and travels with it.
    expect(parsed.profile.secretRefs).toEqual(['DATABASE_URL']);
  });
});
