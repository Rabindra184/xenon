import { describe, expect, it, vi } from 'vitest';
import { buildLaunchPlan } from '../src/main/LaunchBuilder';
import { ProfileStore } from '../src/main/ProfileStore';
import {
  exportableProfile,
  isSecretLikeEnvName,
  moveSecretsToKeychain,
  profileExport,
  profileExportJson,
  stripUrlCredentials,
  type SecretVault
} from '../src/main/profileSecrets';
import { SECRET_DESCRIPTORS, SECRET_SETTINGS, isSecretKey, secretForEnvName } from '../src/shared/secrets';
import type { Profile, SecretKey } from '../src/shared/types';

// ProfileStore keeps its profiles in electron-store, which needs Electron; an in-memory one will do.
vi.mock('electron-store', () => ({
  default: class {
    private data: Record<string, unknown>;
    constructor(opts: { defaults: Record<string, unknown> }) {
      this.data = structuredClone(opts.defaults);
    }
    get(key: string) {
      return this.data[key];
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  }
}));

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
    expect(json).not.toMatch(/file:\/|g-key|sk-1|databaseUrl|geminiApiKey/);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('xenon-control-profile');
    expect(parsed.version).toBe(1);
    expect(parsed.profile.settings).toEqual({ platform: 'android', maxSessions: 2 });
    expect(parsed.profile.env).toEqual({ XENON_JWT_ISSUER: 'lab' });
    // The env vars left out are named, so whoever imports the profile knows what to enter again.
    expect(parsed.strippedEnv).toEqual(['DATABASE_URL', 'OPENAI_API_KEY', 'XENON_HUB_TOKEN']);
    // Which secrets the profile injects is a name, not a value, and travels with it.
    expect(parsed.profile.secretRefs).toEqual(['DATABASE_URL']);
  });
});

describe('isSecretLikeEnvName', () => {
  it.each([
    'CLOUD_KEY',
    'XENON_IP_HASH_SECRET',
    'XENON_BOOTSTRAP_ADMIN_PASSWORD',
    'MY_TOKEN',
    'my_token',
    // A secret word on its own, or in the other spellings tools use.
    'PASSWORD',
    'TOKEN',
    'PGPASSWORD',
    'MYSQL_PWD',
    'DB_PASS',
    'DB_PASSWD',
    'APIKEY',
    'STRIPE_APIKEY',
    'AWS_SECRET_ACCESS_KEY',
    // The OpenTelemetry exporter's headers carry its credentials, for every signal.
    'OTEL_EXPORTER_OTLP_HEADERS',
    'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
    'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
    'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
    // The names the Keychain secrets and their older aliases go by.
    'DATABASE_URL',
    'XENON_SMTP_URL',
    'XENON_HUB_TOKEN',
    'OPENAI_API_KEY'
  ])('%s looks like a secret', (name) => {
    expect(isSecretLikeEnvName(name)).toBe(true);
  });

  it.each([
    'XENON_MCP_TOKEN_TTL_SEC',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'XENON_PUBLIC_URL',
    'XENON_JWT_ISSUER',
    'HTTPS_PROXY',
    'NO_PROXY',
    'MONKEY',
    'COMPASS',
    'BYPASS',
    'constructor'
  ])('%s does not', (name) => {
    expect(isSecretLikeEnvName(name)).toBe(false);
  });
});

describe('stripUrlCredentials', () => {
  it.each([
    ['http://u:p@proxy:3128', 'http://proxy:3128'],
    ['https://user@host/path?x=1#frag', 'https://host/path?x=1#frag'],
    ['https://u:p@host:8443/', 'https://host:8443/'],
    ['socks5://u:p@h:1080', 'socks5://h:1080'],
    ['http://:p@h', 'http://h'],
    ['  http://u:p@proxy:3128  ', '  http://proxy:3128  '],
    // Spaces in the credentials, which the URL parser accepts.
    ['http://a b@c', 'http://c'],
    ['http://user:pa ss@proxy:3128', 'http://proxy:3128'],
    // Any scheme, not only proxies.
    ['redis://:p@h', 'redis://h'],
    ['postgres://u:p@h/db', 'postgres://h/db'],
    ['mongodb+srv://u:p@h', 'mongodb+srv://h'],
    ['smtp://u:p@h:587', 'smtp://h:587'],
    // A proxy written without a scheme.
    ['user:pass@proxy:3128', 'proxy:3128'],
    ['user:pass@proxy', 'proxy'],
    ['user:p@ss@proxy:3128', 'proxy:3128'],
    ['  user:pass@10.0.0.5:3128  ', '  10.0.0.5:3128  ']
  ])('%j becomes %j', (value, stripped) => {
    expect(stripUrlCredentials(value)).toBe(stripped);
  });

  it.each([
    'http://proxy:3128',
    'https://host/path',
    'postgres://h/db',
    'localhost,127.0.0.1',
    '*.internal.example.com',
    'file:///tmp/xenon.db',
    'proxy:3128',
    'ops@example.com',
    'git@github.com:org/repo.git',
    'redis:7@sha256:abc',
    'user:pass@',
    '',
    'not a url'
  ])('returns %j as it is, and does not throw', (value) => {
    expect(stripUrlCredentials(value)).toBe(value);
  });

  // A URL parser rejects these (a host list, a slash in the password, a quote or a space around the
  // address), or reads them as one address, but the credentials are still in the text.
  it.each([
    ['mongodb://u:p@h1:27017,h2:27017/db?replicaSet=rs0', 'mongodb://h1:27017,h2:27017/db?replicaSet=rs0'],
    ['postgres://u:p@h1:5432,h2:5432/db', 'postgres://h1:5432,h2:5432/db'],
    ['http://u:pa/ss@proxy:3128', 'http://proxy:3128'],
    ['http://u:pa?ss@proxy:3128', 'http://proxy:3128'],
    ['http://u:pa#ss@proxy:3128', 'http://proxy:3128'],
    ['"http://u:p@proxy:3128"', '"http://proxy:3128"'],
    ["'http://u:p@proxy:3128'", "'http://proxy:3128'"],
    ['-Dhttp.proxy=http://u:p@proxy', '-Dhttp.proxy=http://proxy'],
    ['http://u:p@h1 http://u:p@h2', 'http://h1 http://h2'],
    // One address parses with credentials, or without, and the next one has them.
    ['http://u:p@h1/ http://u:p@h2', 'http://h1/ http://h2'],
    ['http://h1/ http://u:p@h2', 'http://h1/ http://h2'],
    ['http://h1/,http://u:p@h2', 'http://h1/,http://h2']
  ])('cuts the credentials from %j', (value, stripped) => {
    expect(stripUrlCredentials(value)).toBe(stripped);
  });

  it.each([
    'not a url',
    'localhost,127.0.0.1',
    'http://bad host/x',
    // An `@` in a path or query is not a credential.
    'https://medium.com/@user',
    'http://h/x?e=a@b',
    'http://h/x#a@b',
    'https://h/a@b/c@d'
  ])('returns %j as it is, with no credentials to cut', (value) => {
    expect(stripUrlCredentials(value)).toBe(value);
  });

  it('keeps an `@` in the path or query of an address it cuts credentials from', () => {
    expect(stripUrlCredentials('https://u:p@h/a@b')).toBe('https://h/a@b');
    expect(stripUrlCredentials('https://u:p@medium.com/@user?e=a@b')).toBe('https://medium.com/@user?e=a@b');
  });

  it('takes a long value in linear time, whatever it holds', () => {
    const n = 200_000;
    // Each of these made a scheme pattern tried from every position quadratic (a minute or more).
    const values = [
      'http://' + 'a'.repeat(n),
      'a'.repeat(n),
      'a'.repeat(n) + '://b',
      'a:' + '@a'.repeat(n / 2),
      '@'.repeat(n),
      'http://' + '@'.repeat(n),
      '://'.repeat(n / 3),
      'a://'.repeat(n / 4),
      // The parser rejects these, which cuts to the last `@` of each run.
      'http://[' + 'a://'.repeat(n / 4),
      'http://[' + 'a://x'.repeat(n / 5),
      'http://[' + 'a@://'.repeat(n / 5),
      'http://u:p@h '.repeat(n / 13)
    ];
    for (const value of values) {
      const start = performance.now();
      stripUrlCredentials(value);
      // Quadratic would take far longer than this; linear takes a few milliseconds.
      expect(performance.now() - start).toBeLessThan(500);
    }
  });

  it('falls back to the parsed address when the credentials are not spelled the usual way', () => {
    // No slashes after the scheme.
    expect(stripUrlCredentials('http:u:p@proxy')).toBe('http://proxy/');
    // A leading control character the URL parser skips over.
    expect(stripUrlCredentials('\x01http://u:p@h')).toBe('http://h/');
  });
});

describe('exportableProfile', () => {
  it('drops env vars that look like secrets and lists their names, sorted', () => {
    const p = makeProfile({
      env: {
        MY_TOKEN: 't',
        CLOUD_KEY: 'k',
        XENON_IP_HASH_SECRET: 's',
        XENON_BOOTSTRAP_ADMIN_PASSWORD: 'pw',
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer x',
        DATABASE_URL: 'file:/y.db',
        XENON_MCP_TOKEN_TTL_SEC: '3600',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        XENON_PUBLIC_URL: 'http://lab-mac:4723'
      }
    });
    const { profile, strippedEnv } = exportableProfile(p);
    expect(profile.env).toEqual({
      XENON_MCP_TOKEN_TTL_SEC: '3600',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      XENON_PUBLIC_URL: 'http://lab-mac:4723'
    });
    expect(strippedEnv).toEqual([
      'CLOUD_KEY',
      'DATABASE_URL',
      'MY_TOKEN',
      'OTEL_EXPORTER_OTLP_HEADERS',
      'XENON_BOOTSTRAP_ADMIN_PASSWORD',
      'XENON_IP_HASH_SECRET'
    ]);
  });

  it('also drops a bare password or token name, the other spellings and every signal\'s OTLP headers', () => {
    const p = makeProfile({
      env: {
        PASSWORD: 'a',
        PGPASSWORD: 'b',
        MYSQL_PWD: 'c',
        DB_PASS: 'd',
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'e',
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'f',
        OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'g',
        NO_PROXY: 'localhost',
        XENON_MCP_TOKEN_TTL_SEC: '3600',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        XENON_PUBLIC_URL: 'http://lab-mac:4723'
      }
    });
    const { profile, strippedEnv } = exportableProfile(p);
    expect(profile.env).toEqual({
      NO_PROXY: 'localhost',
      XENON_MCP_TOKEN_TTL_SEC: '3600',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      XENON_PUBLIC_URL: 'http://lab-mac:4723'
    });
    expect(strippedEnv).toEqual([
      'DB_PASS',
      'MYSQL_PWD',
      'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
      'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
      'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
      'PASSWORD',
      'PGPASSWORD'
    ]);
  });

  it('keeps a service address without its credentials, whatever the scheme, and does not list it as dropped', () => {
    const { profile, strippedEnv } = exportableProfile(
      makeProfile({
        env: {
          REDIS_URL: 'redis://:p@h',
          POSTGRES_URL: 'postgres://u:p@h/db',
          MONGO_URL: 'mongodb+srv://u:p@h',
          MAIL_URL: 'smtp://u:p@h:587',
          ALL_PROXY: 'user:pass@proxy:3128'
        }
      })
    );
    expect(profile.env).toEqual({
      REDIS_URL: 'redis://h',
      POSTGRES_URL: 'postgres://h/db',
      MONGO_URL: 'mongodb+srv://h',
      MAIL_URL: 'smtp://h:587',
      ALL_PROXY: 'proxy:3128'
    });
    expect(strippedEnv).toEqual([]);
  });

  it('keeps a proxy address without its credentials, and does not list it as dropped', () => {
    const { profile, strippedEnv } = exportableProfile(
      makeProfile({ env: { HTTPS_PROXY: 'http://u:p@proxy:3128', NO_PROXY: 'localhost,127.0.0.1', X: 'http://a b@c' } })
    );
    // Nothing here throws; an address with a space in its user name is cleaned like any other.
    expect(profile.env).toEqual({ HTTPS_PROXY: 'http://proxy:3128', NO_PROXY: 'localhost,127.0.0.1', X: 'http://c' });
    expect(strippedEnv).toEqual([]);
  });

  it('keeps an env value that is not text as it is (an imported profile can hold anything)', () => {
    const p = makeProfile({ env: { RETRIES: 3, FLAG: null } as unknown as Record<string, string> });
    expect(exportableProfile(p).profile.env).toEqual({ RETRIES: 3, FLAG: null });
  });

  it('removes the cloud API key and keeps the rest of the cloud settings', () => {
    const { profile } = exportableProfile(
      makeProfile({ settings: { platform: 'android', cloud: { provider: 'lambdatest', user: 'qa', apiKey: 'k-1' } } })
    );
    expect(profile.settings.cloud).toEqual({ provider: 'lambdatest', user: 'qa' });
    expect(JSON.stringify(profile)).not.toContain('k-1');
  });

  it('removes the proxy password and keeps the proxy user', () => {
    const { profile } = exportableProfile(
      makeProfile({
        settings: { platform: 'android', proxy: { host: 'proxy', port: 3128, auth: { username: 'qa', password: 'pw-1' } } }
      })
    );
    expect(profile.settings.proxy).toEqual({ host: 'proxy', port: 3128, auth: { username: 'qa' } });
    expect(JSON.stringify(profile)).not.toContain('pw-1');
  });

  it('lists the settings it removed, by dotted path and sorted, so the export can say what was left out', () => {
    const { strippedSettings } = exportableProfile(
      makeProfile({
        settings: {
          platform: 'android',
          cloud: { provider: 'lambdatest', apiKey: 'k' },
          proxy: { host: 'proxy', auth: { username: 'qa', password: 'p' } }
        }
      })
    );
    expect(strippedSettings).toEqual(['cloud.apiKey', 'proxy.auth.password']);
  });

  it('lists a secret-bearing setting such as an AI key, by its own name', () => {
    const { profile, strippedSettings } = exportableProfile(
      makeProfile({ settings: { platform: 'android', geminiApiKey: 'g', databaseUrl: 'file:/y.db', openaiApiKey: 'o' } })
    );
    expect(strippedSettings).toEqual(['databaseUrl', 'geminiApiKey', 'openaiApiKey']);
    expect(profile.settings).toEqual({ platform: 'android' });
  });

  it('does not list a removed setting that held no value', () => {
    const { profile, strippedSettings } = exportableProfile(
      makeProfile({
        settings: {
          platform: 'android',
          geminiApiKey: '',
          openaiApiKey: null,
          cloud: { provider: 'x', apiKey: '' },
          proxy: { host: 'proxy', auth: { username: 'qa', password: undefined } }
        }
      })
    );
    expect(strippedSettings).toEqual([]);
    // Still removed: nothing secret-shaped is exported, valued or not.
    expect(profile.settings).toEqual({
      platform: 'android',
      cloud: { provider: 'x' },
      proxy: { host: 'proxy', auth: { username: 'qa' } }
    });
  });

  it('lists none for a profile with no secret setting, and leaves the env list alone', () => {
    const result = exportableProfile(makeProfile({ env: { MY_TOKEN: 't' } }));
    expect(result.strippedSettings).toEqual([]);
    expect(result.strippedEnv).toEqual(['MY_TOKEN']);
  });

  it('copes with cloud and proxy settings that are not the shape it expects', () => {
    for (const settings of [
      { platform: 'android' },
      { platform: 'android', cloud: 'x', proxy: 'http://proxy' },
      { platform: 'android', cloud: null, proxy: { host: 'proxy', auth: 'none' } },
      { platform: 'android', cloud: { provider: 'x' }, proxy: { host: 'proxy', auth: { username: 'qa' } } }
    ]) {
      expect(exportableProfile(makeProfile({ settings })).profile.settings).toEqual(settings);
    }
  });

  it('cuts the credentials from the hub, the cloud addresses and the AI base URL, and keeps the rest of the settings', () => {
    const { profile } = exportableProfile(
      makeProfile({
        settings: {
          platform: 'android',
          hub: 'http://u:p@hub-mac:4723',
          aiBaseUrl: 'https://key:s3@gateway.example/v1',
          cloud: {
            cloudName: 'lambdatest',
            url: 'https://qa:pw@hub.lambdatest.example/wd/hub',
            apiUrl: 'https://qa:pw@api.lambdatest.example',
            apiKey: 'k-1'
          }
        }
      })
    );
    expect(profile.settings).toEqual({
      platform: 'android',
      hub: 'http://hub-mac:4723',
      aiBaseUrl: 'https://gateway.example/v1',
      cloud: { cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub', apiUrl: 'https://api.lambdatest.example' }
    });
  });

  it.each([
    ['hub', { hub: 'http://u:p@hub-mac:4723' }, { hub: 'http://hub-mac:4723' }],
    ['aiBaseUrl', { aiBaseUrl: 'http://u:p@ollama:11434' }, { aiBaseUrl: 'http://ollama:11434' }],
    ['cloud.url', { cloud: { url: 'https://u:p@h/wd' } }, { cloud: { url: 'https://h/wd' } }],
    ['cloud.apiUrl', { cloud: { apiUrl: 'https://u:p@h/api' } }, { cloud: { apiUrl: 'https://h/api' } }],
    // Written so a URL parser rejects it, which a hub address that is only typed can be.
    ['hub with a slash in the password', { hub: 'http://u:pa/ss@hub:4723' }, { hub: 'http://hub:4723' }]
  ])('cuts the credentials from %s', (_name, settings, expected) => {
    const { profile } = exportableProfile(makeProfile({ settings: { platform: 'android', ...settings } }));
    expect(profile.settings).toEqual({ platform: 'android', ...expected });
  });

  it('leaves an address setting without credentials, or one that is not text, as it is', () => {
    const settings = {
      platform: 'android',
      hub: 'http://hub-mac:4723',
      aiBaseUrl: 3,
      cloud: { url: 'https://hub.example/wd/hub', apiUrl: null }
    };
    expect(exportableProfile(makeProfile({ settings })).profile.settings).toEqual(settings);
    const odd = { platform: 'android', hub: 7, cloud: 'x' } as Record<string, unknown>;
    expect(exportableProfile(makeProfile({ settings: odd })).profile.settings).toEqual(odd);
  });

  it('does not change the profile it is given', () => {
    const p = makeProfile({
      settings: { platform: 'android', cloud: { apiKey: 'k' }, proxy: { auth: { username: 'qa', password: 'pw' } } },
      env: { MY_TOKEN: 't', HTTPS_PROXY: 'http://u:p@proxy:3128' }
    });
    const copy = structuredClone(p);
    exportableProfile(p);
    expect(p).toEqual(copy);
  });

  it('does not change the address settings it cuts credentials from', () => {
    const p = makeProfile({
      settings: {
        platform: 'android',
        hub: 'http://u:p@hub:4723',
        aiBaseUrl: 'http://u:p@ollama:11434',
        cloud: { url: 'https://u:p@h/wd', apiUrl: 'https://u:p@h/api' }
      }
    });
    const copy = structuredClone(p);
    exportableProfile(p);
    expect(p).toEqual(copy);
  });
});

describe('profileExport', () => {
  it('names what it left out, env vars first and then settings, and keeps the file as profileExportJson writes it', () => {
    const p = makeProfile({
      env: { MY_TOKEN: 't', RETRIES: '3', CLOUD_KEY: 'k' },
      settings: { platform: 'android', cloud: { apiKey: 'k-1' }, geminiApiKey: 'g' }
    });
    const { json, leftOut } = profileExport(p);
    expect(leftOut).toEqual(['CLOUD_KEY', 'MY_TOKEN', 'cloud.apiKey', 'geminiApiKey']);
    expect(json).toBe(profileExportJson(p));
    expect(json).not.toMatch(/k-1|"g"/);
  });

  it('leaves nothing out of a profile with no secret, and of one whose secret settings are empty', () => {
    expect(profileExport(makeProfile()).leftOut).toEqual([]);
    expect(profileExport(makeProfile({ settings: { platform: 'android', geminiApiKey: '' } })).leftOut).toEqual([]);
  });
});

describe('profileExportJson with secret-looking values', () => {
  it('names what it dropped under strippedEnv, sorted, and carries no value', () => {
    const p = makeProfile({
      settings: { platform: 'android', cloud: { apiKey: 'k-9' }, proxy: { auth: { username: 'qa', password: 'pw-9' } } },
      env: { MY_TOKEN: 't-9', CLOUD_KEY: 'c-9', HTTPS_PROXY: 'http://u:p9@proxy:3128', XENON_PUBLIC_URL: 'http://lab-mac:4723' }
    });
    const json = profileExportJson(p);
    expect(json).not.toMatch(/k-9|pw-9|t-9|c-9|p9/);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('xenon-control-profile');
    expect(parsed.version).toBe(1);
    expect(parsed.strippedEnv).toEqual(['CLOUD_KEY', 'MY_TOKEN']);
    expect(parsed.profile.env).toEqual({ HTTPS_PROXY: 'http://proxy:3128', XENON_PUBLIC_URL: 'http://lab-mac:4723' });
  });

  it('carries no credential from an address a URL parser rejects, in an env var or an address setting', () => {
    const p = makeProfile({
      settings: {
        platform: 'android',
        hub: 'http://hubuser:hubpw9@hub-mac:4723',
        aiBaseUrl: 'http://aiuser:aipw9@ollama:11434',
        cloud: { url: 'https://cu:cpw9@hub.example/wd/hub', apiUrl: 'https://cu:cpw9@api.example' }
      },
      env: {
        MONGO_URL: 'mongodb://mu:mpw9@h1:27017,h2:27017/db?replicaSet=rs0',
        PG_URL: 'postgres://pu:ppw9@h1:5432,h2:5432/db',
        HTTP_PROXY: 'http://xu:xpa9/ss@proxy:3128',
        QUOTED: '"http://qu:qpw9@proxy:3128"',
        JAVA_TOOL_OPTIONS: '-Dhttp.proxy=http://ju:jpw9@proxy',
        LIST: 'http://lu:lpw9@h1 http://lu:lpw9@h2'
      }
    });
    const json = profileExportJson(p);
    expect(json).not.toMatch(/hubuser|hubpw9|aiuser|aipw9|cu:|cpw9|mu:|mpw9|pu:|ppw9|xu:|xpa9|ss@|qu:|qpw9|ju:|jpw9|lu:|lpw9/);
    const exported = JSON.parse(json).profile;
    expect(exported.settings.hub).toBe('http://hub-mac:4723');
    expect(exported.env.MONGO_URL).toBe('mongodb://h1:27017,h2:27017/db?replicaSet=rs0');
    expect(exported.env.LIST).toBe('http://h1 http://h2');
  });

  it('has no strippedEnv when it dropped no env var', () => {
    const p = makeProfile({
      settings: { platform: 'android', cloud: { apiKey: 'k' } },
      env: { XENON_PUBLIC_URL: 'http://lab-mac:4723' }
    });
    expect('strippedEnv' in JSON.parse(profileExportJson(p))).toBe(false);
    expect('strippedEnv' in JSON.parse(profileExportJson(makeProfile()))).toBe(false);
  });

  it('is imported again by ProfileStore, whatever strippedEnv it carries', () => {
    const store = new ProfileStore(makeVault());
    const exported = profileExportJson(makeProfile({ name: 'Lab', env: { MY_TOKEN: 't', XENON_PUBLIC_URL: 'http://lab-mac:4723' } }));
    expect(JSON.parse(exported).strippedEnv).toEqual(['MY_TOKEN']);
    const [imported, ...rest] = store.importFrom(JSON.parse(exported));
    expect(rest).toEqual([]);
    expect(imported.name).toBe('Lab');
    expect(imported.id).not.toBe('p1');
    expect(imported.env).toEqual({ XENON_PUBLIC_URL: 'http://lab-mac:4723' });
    expect(imported.settings.platform).toBe('android');
  });
});

// Fake values only: a real key or password must never reach a test's output.
const CLOUD_KEY = 'k-test-123';
const PROXY_PASSWORD = 'p@ss:w/rd';

const cloudWith = (apiKey: unknown) => ({ cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub', apiKey });
const proxyWith = (password: unknown) => ({ host: 'squid.lab', port: 3128, auth: { username: 'qa', password } });

/** Runs the move twice and checks the second run changes nothing, in the profiles or the Keychain. */
function moveSettled(profiles: Profile[], vault: ReturnType<typeof makeVault>, opts?: { onSave?: boolean }) {
  const result = moveSecretsToKeychain(profiles, vault, opts);
  const stored = { ...vault.values };
  const again = moveSecretsToKeychain(result.profiles, vault, opts);
  expect(again.changed).toBe(false);
  expect(again.profiles).toEqual(result.profiles);
  expect(vault.values).toEqual(stored);
  return result;
}

describe('the cloud key and proxy password secrets', () => {
  it('are offered with their labels and descriptions', () => {
    expect(SECRET_DESCRIPTORS).toEqual(
      expect.arrayContaining([
        { key: 'CLOUD_KEY', label: 'Cloud access key', description: 'The cloud provider key Xenon passes as CLOUD_KEY.' },
        {
          key: 'PROXY_PASSWORD',
          label: 'Proxy password',
          description: 'The password for the proxy in this profile’s proxy settings.'
        }
      ])
    );
    expect(isSecretKey('CLOUD_KEY')).toBe(true);
    expect(isSecretKey('PROXY_PASSWORD')).toBe(true);
  });
});

describe('moveSecretsToKeychain: the cloud key', () => {
  it('moves cloud.apiKey into the Keychain as CLOUD_KEY, injects it, and keeps the rest of the cloud settings', () => {
    const vault = makeVault();
    const p = makeProfile({ settings: { platform: 'android', cloud: cloudWith('k') } });
    const { profiles, changed } = moveSettled([p], vault);
    expect(changed).toBe(true);
    expect(vault.values.CLOUD_KEY).toBe('k');
    expect(profiles[0].secretRefs).toContain('CLOUD_KEY');
    expect(profiles[0].settings.cloud).toEqual({ cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub' });
    expect('apiKey' in (profiles[0].settings.cloud as object)).toBe(false);
  });

  it('drops the profile’s key and keeps a different one already in the Keychain', () => {
    const vault = makeVault({ CLOUD_KEY: 'k-other-456' });
    const p = makeProfile({ settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY) } });
    const { profiles } = moveSettled([p], vault);
    expect(vault.values.CLOUD_KEY).toBe('k-other-456');
    expect(profiles[0].settings.cloud).toEqual({ cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub' });
    expect(profiles[0].secretRefs).toEqual(['CLOUD_KEY']);
  });

  it('with two profiles on different keys, stores the first, and the second keeps its own, as safeToStore decides', () => {
    const vault = makeVault();
    const first = makeProfile({ id: 'a', settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY) } });
    const second = makeProfile({ id: 'b', settings: { platform: 'android', cloud: cloudWith('k-other-456') } });
    const { profiles } = moveSettled([first, second], vault);
    expect(vault.values).toEqual({ CLOUD_KEY });
    expect(profiles[0].secretRefs).toEqual(['CLOUD_KEY']);
    expect(profiles[1]).toBe(second);
  });

  it('moves a key the Keychain already holds, the same one, and injects it', () => {
    const vault = makeVault({ CLOUD_KEY });
    const p = makeProfile({ settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY) } });
    const { profiles } = moveSettled([p], vault);
    expect(profiles[0].secretRefs).toEqual(['CLOUD_KEY']);
    expect('apiKey' in (profiles[0].settings.cloud as object)).toBe(false);
  });

  it('drops the profile’s key when it already injects a stored one, even with another profile injecting it too', () => {
    const vault = makeVault({ CLOUD_KEY: 'k-other-456' });
    const p = makeProfile({ id: 'a', secretRefs: ['CLOUD_KEY'], settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY) } });
    const other = makeProfile({ id: 'b', secretRefs: ['CLOUD_KEY'] });
    const { profiles } = moveSettled([p, other], vault);
    expect(vault.values.CLOUD_KEY).toBe('k-other-456');
    expect('apiKey' in (profiles[0].settings.cloud as object)).toBe(false);
    expect(profiles[0].secretRefs).toEqual(['CLOUD_KEY']);
  });

  it('leaves the key in place when another profile injects a different stored key', () => {
    const vault = makeVault({ CLOUD_KEY: 'k-other-456' });
    const p = makeProfile({ id: 'a', settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY) } });
    const injects = makeProfile({ id: 'b', secretRefs: ['CLOUD_KEY'] });
    const { profiles, changed } = moveSettled([p, injects], vault);
    expect(changed).toBe(false);
    expect(profiles[0]).toBe(p);
  });

  it('does not store it when another profile injects CLOUD_KEY and none is stored yet', () => {
    const vault = makeVault();
    const p = makeProfile({ id: 'a', settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY) } });
    const injects = makeProfile({ id: 'b', secretRefs: ['CLOUD_KEY'] });
    const { profiles, changed } = moveSettled([p, injects], vault);
    expect(changed).toBe(false);
    expect(vault.values).toEqual({});
    expect(profiles[0]).toBe(p);
  });

  it('still moves a CLOUD_KEY environment variable, which the launch passed, and injects it', () => {
    const vault = makeVault();
    const p = makeProfile({ env: { CLOUD_KEY, XENON_JWT_ISSUER: 'lab' } });
    const { profiles } = moveKeepingLaunches([p], vault);
    expect(vault.values.CLOUD_KEY).toBe(CLOUD_KEY);
    expect(profiles[0].env).toEqual({ XENON_JWT_ISSUER: 'lab' });
    expect(profiles[0].secretRefs).toEqual(['CLOUD_KEY']);
  });

  it('lets a CLOUD_KEY env var in use take the slot before a key typed in the cloud settings', () => {
    const vault = makeVault();
    const typed = makeProfile({ id: 'a', settings: { platform: 'android', cloud: cloudWith('k-typed-1') } });
    const inUse = makeProfile({ id: 'b', env: { CLOUD_KEY } });
    const { profiles } = moveSettled([typed, inUse], vault);
    expect(vault.values.CLOUD_KEY).toBe(CLOUD_KEY);
    expect(profiles[1].secretRefs).toEqual(['CLOUD_KEY']);
    // The typed key is not stored over it, and the other profile injects it now, so it stays where it is.
    expect(profiles[0]).toBe(typed);
  });
});

describe('moveSecretsToKeychain: the proxy password', () => {
  it('moves proxy.auth.password into the Keychain as PROXY_PASSWORD, injects it, and the launch is the same', () => {
    const vault = makeVault();
    const p = makeProfile({ settings: { platform: 'android', proxy: proxyWith(PROXY_PASSWORD) } });
    const { profiles, changed } = moveKeepingLaunches([p], vault);
    expect(changed).toBe(true);
    expect(vault.values.PROXY_PASSWORD).toBe(PROXY_PASSWORD);
    expect(profiles[0].secretRefs).toContain('PROXY_PASSWORD');
    expect(profiles[0].settings.proxy).toEqual({ host: 'squid.lab', port: 3128, auth: { username: 'qa' } });
  });

  it('drops the profile’s password and keeps a different one already in the Keychain', () => {
    const vault = makeVault({ PROXY_PASSWORD: 'p-other' });
    const p = makeProfile({ settings: { platform: 'android', proxy: proxyWith(PROXY_PASSWORD) } });
    const { profiles } = moveSettled([p], vault);
    expect(vault.values.PROXY_PASSWORD).toBe('p-other');
    expect(profiles[0].settings.proxy).toEqual({ host: 'squid.lab', port: 3128, auth: { username: 'qa' } });
    expect(profiles[0].secretRefs).toEqual(['PROXY_PASSWORD']);
  });

  it('with two profiles on different passwords, stores the first, and the second keeps its own', () => {
    const vault = makeVault();
    const first = makeProfile({ id: 'a', settings: { platform: 'android', proxy: proxyWith(PROXY_PASSWORD) } });
    const second = makeProfile({ id: 'b', settings: { platform: 'android', proxy: proxyWith('p-other') } });
    const { profiles } = moveKeepingLaunches([first, second], vault);
    expect(vault.values).toEqual({ PROXY_PASSWORD });
    expect(profiles[0].secretRefs).toEqual(['PROXY_PASSWORD']);
    expect(profiles[1]).toBe(second);
  });

  it('never moves an environment variable named PROXY_PASSWORD: it would become the proxy’s password', () => {
    const vault = makeVault();
    const p = makeProfile({
      settings: { platform: 'android', proxy: { host: 'squid.lab', auth: { username: 'qa' } } },
      env: { PROXY_PASSWORD: 'p-env-1' }
    });
    const { profiles, changed } = moveKeepingLaunches([p], vault);
    expect(changed).toBe(false);
    expect(profiles[0]).toBe(p);
    expect(vault.values).toEqual({});
  });

  it('does not count an env var named PROXY_PASSWORD as passing the password, when another profile injects it', () => {
    const vault = makeVault();
    const p = makeProfile({ id: 'a', settings: { platform: 'android', proxy: proxyWith(PROXY_PASSWORD) } });
    const injects = makeProfile({ id: 'b', secretRefs: ['PROXY_PASSWORD'], env: { PROXY_PASSWORD } });
    const { profiles } = moveSecretsToKeychain([p, injects], vault);
    expect(vault.values).toEqual({});
    expect(profiles[0]).toBe(p);
  });
});

describe('moveSecretsToKeychain: cloud and proxy values it leaves or tidies', () => {
  it('never overwrites a stored value it cannot read, and keeps everything when the Keychain is unavailable', () => {
    for (const vault of [
      makeVault({}, { unreadable: ['CLOUD_KEY', 'PROXY_PASSWORD'] }),
      makeVault({}, { unavailable: true })
    ]) {
      const p = makeProfile({ settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY), proxy: proxyWith(PROXY_PASSWORD) } });
      const { profiles, changed } = moveSettled([p], vault);
      expect(changed).toBe(false);
      expect(profiles[0]).toBe(p);
      expect(vault.values).toEqual({});
    }
  });

  it('removes an empty key or password without storing or injecting anything', () => {
    const vault = makeVault();
    const p = makeProfile({ settings: { platform: 'android', cloud: cloudWith(''), proxy: proxyWith(null) } });
    const { profiles, changed } = moveSettled([p], vault);
    expect(changed).toBe(true);
    expect(vault.values).toEqual({});
    expect(profiles[0].secretRefs).toEqual([]);
    expect(profiles[0].settings.cloud).toEqual({ cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub' });
    expect(profiles[0].settings.proxy).toEqual({ host: 'squid.lab', port: 3128, auth: { username: 'qa' } });
  });

  it('leaves a value that is not text, and settings that are not the shape it expects', () => {
    const vault = makeVault();
    const odd = [
      makeProfile({ id: 'a', settings: { platform: 'android', cloud: cloudWith(42) } }),
      makeProfile({ id: 'b', settings: { platform: 'android', cloud: 'k', proxy: 'http://u:p@squid.lab' } }),
      makeProfile({ id: 'c', settings: { platform: 'android', cloud: null, proxy: { host: 'squid.lab', auth: 'none' } } }),
      makeProfile({ id: 'd', settings: { platform: 'android', proxy: { host: 'squid.lab', auth: ['p'] } } })
    ];
    const { profiles, changed } = moveSettled(odd, vault);
    expect(changed).toBe(false);
    odd.forEach((p, i) => expect(profiles[i]).toBe(p));
  });

  it('does not change the profiles it is given', () => {
    const vault = makeVault();
    const p = makeProfile({ settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY), proxy: proxyWith(PROXY_PASSWORD) } });
    const copy = structuredClone(p);
    moveSecretsToKeychain([p], vault);
    expect(p).toEqual(copy);
  });
});

describe('moveSecretsToKeychain on a save', () => {
  // The renderer saves while someone types, so a value typed into an env var arrives a few letters at a time.
  it('stores no env var named like a secret, however many saves it takes to type it', () => {
    const vault = makeVault();
    for (const typed of ['f', 'fi', 'fil', 'file:/x.db']) {
      const p = makeProfile({ env: { DATABASE_URL: typed } });
      const { profiles, changed } = moveSecretsToKeychain([p], vault, { onSave: true });
      expect(changed).toBe(false);
      expect(profiles[0]).toBe(p);
    }
    expect(vault.values).toEqual({});
  });

  it('strips an env var the Keychain already holds, the same value, and injects it', () => {
    const vault = makeVault({ DATABASE_URL: 'file:/x.db' });
    const p = makeProfile({ env: { DATABASE_URL: 'file:/x.db' } });
    const { profiles } = moveSettled([p], vault, { onSave: true });
    expect(profiles[0].env).toEqual({});
    expect(profiles[0].secretRefs).toEqual(['DATABASE_URL']);
  });

  it('strips an env var the profile’s injected secret overrides', () => {
    const vault = makeVault({ DATABASE_URL: 'file:/a.db' });
    const p = makeProfile({ env: { DATABASE_URL: 'file:/b.db' }, secretRefs: ['DATABASE_URL'] });
    const { profiles } = moveSettled([p], vault, { onSave: true });
    expect(profiles[0].env).toEqual({});
    expect(vault.values.DATABASE_URL).toBe('file:/a.db');
  });

  it('still stores the settings it moves, which are saved whole', () => {
    const vault = makeVault();
    const p = makeProfile({
      settings: { platform: 'android', geminiApiKey: 'g-test-123', cloud: cloudWith(CLOUD_KEY), proxy: proxyWith(PROXY_PASSWORD) }
    });
    const { profiles } = moveSettled([p], vault, { onSave: true });
    expect(vault.values).toEqual({ XENON_GEMINI_API_KEY: 'g-test-123', CLOUD_KEY, PROXY_PASSWORD });
    expect(JSON.stringify(profiles)).not.toMatch(/g-test-123|k-test-123|p@ss/);
  });
});

describe('profileExportJson: the cloud key and the proxy password', () => {
  it('contains neither value', () => {
    const p = makeProfile({
      settings: { platform: 'android', cloud: cloudWith(CLOUD_KEY), proxy: proxyWith(PROXY_PASSWORD) },
      secretRefs: ['CLOUD_KEY', 'PROXY_PASSWORD']
    });
    const json = profileExportJson(p);
    expect(json).not.toMatch(/k-test-123|p@ss|p%40ss/);
    expect(JSON.parse(json).profile.secretRefs).toEqual(['CLOUD_KEY', 'PROXY_PASSWORD']);
  });
});
