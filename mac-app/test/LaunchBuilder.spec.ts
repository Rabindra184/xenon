import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { buildConfigYaml, buildLaunchPlan, skippedSettingsLine } from '../src/main/LaunchBuilder';
import { humanize } from '../src/shared/humanize';
import type { Profile, XenonSchema } from '../src/shared/types';
import { readRepoSchema } from './repoSchema';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Test',
    settings: { platform: 'android', enableDashboard: true, maxSessions: 4 },
    server: { port: 4723, basePath: '/wd/hub', appiumHome: '', keepAliveTimeout: 800 },
    secretRefs: [],
    env: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

describe('buildConfigYaml', () => {
  it('emits an Appium config with xenon under server.plugin and use-plugins', () => {
    const doc = yaml.load(buildConfigYaml(makeProfile())) as any;
    expect(doc.server.port).toBe(4723);
    expect(doc.server['base-path']).toBe('/wd/hub');
    expect(doc.server['use-plugins']).toEqual(['xenon']);
    expect(doc.server.plugin.xenon.platform).toBe('android');
    expect(doc.server.plugin.xenon.enableDashboard).toBe(true);
  });

  it('never writes secret-bearing settings into the config file', () => {
    const p = makeProfile({
      settings: { platform: 'android', geminiApiKey: 'SECRET', databaseUrl: 'postgres://x', maxSessions: 2 }
    });
    const doc = yaml.load(buildConfigYaml(p)) as any;
    expect(doc.server.plugin.xenon.geminiApiKey).toBeUndefined();
    expect(doc.server.plugin.xenon.databaseUrl).toBeUndefined();
    expect(doc.server.plugin.xenon.maxSessions).toBe(2);
  });

  it('never writes a retired setting, even one an older profile still holds', () => {
    const p = makeProfile({ settings: { platform: 'android', databaseProvider: 'postgresql', maxSessions: 2 } });
    const doc = yaml.load(buildConfigYaml(p)) as any;
    expect('databaseProvider' in doc.server.plugin.xenon).toBe(false);
    expect(doc.server.plugin.xenon.maxSessions).toBe(2);
  });

  it.each([
    ['http://hub-mac:4723/', 'http://hub-mac:4723'],
    ['  http://hub-mac:4723  ', 'http://hub-mac:4723'],
    ['http://u:p@hub-mac:4723', 'http://hub-mac:4723'],
    ['https://10.0.0.5', 'https://10.0.0.5']
  ])('writes the hub %j as its plain origin %j', (hub, written) => {
    // The plugin appends /xenon/api/register to the hub, so a trailing slash would double up.
    const doc = yaml.load(buildConfigYaml(makeProfile({ settings: { platform: 'android', hub } }))) as any;
    expect(doc.server.plugin.xenon.hub).toBe(written);
  });

  it('leaves an unset or empty hub out of the config', () => {
    for (const hub of [undefined, '']) {
      const doc = yaml.load(buildConfigYaml(makeProfile({ settings: { platform: 'android', hub } }))) as any;
      expect('hub' in doc.server.plugin.xenon).toBe(false);
    }
    const none = yaml.load(buildConfigYaml(makeProfile())) as any;
    expect('hub' in none.server.plugin.xenon).toBe(false);
  });

  it('leaves a hub that is blank after trimming out of the config, like an unset one', () => {
    // The plugin would otherwise try to register this node against a blank address.
    for (const hub of ['   ', '\t', ' \n ']) {
      const doc = yaml.load(buildConfigYaml(makeProfile({ settings: { platform: 'android', hub } }))) as any;
      expect('hub' in doc.server.plugin.xenon).toBe(false);
    }
  });

  it('leaves a hub that is not an http(s) address as it is (validation blocks it before launch)', () => {
    const doc = yaml.load(buildConfigYaml(makeProfile({ settings: { platform: 'android', hub: 'hub-mac:4723' } }))) as any;
    expect(doc.server.plugin.xenon.hub).toBe('hub-mac:4723');
  });

  it('drops empty/undefined values so schema validation is not tripped', () => {
    const p = makeProfile({ settings: { platform: 'android', hub: '', aiModel: undefined } });
    const doc = yaml.load(buildConfigYaml(p)) as any;
    expect(doc.server.plugin.xenon.hub).toBeUndefined();
    expect('aiModel' in doc.server.plugin.xenon).toBe(false);
  });

  it('fills required-key defaults so Appium --config validation passes, user values winning', () => {
    // Appium rejects a --config missing any schema-required property.
    const requiredDefaults = { enableJsonLogging: false, maxSessions: 8, platform: 'both' };
    const p = makeProfile({ settings: { platform: 'android' } }); // overrides one default
    const doc = yaml.load(buildConfigYaml(p, requiredDefaults)) as any;
    expect(doc.server.plugin.xenon.enableJsonLogging).toBe(false); // required default present
    expect(doc.server.plugin.xenon.maxSessions).toBe(8); // required default present
    expect(doc.server.plugin.xenon.platform).toBe('android'); // user value wins over default
  });

  it('enables Android H.264 (scrcpy) live preview by default for every profile', () => {
    // A profile with no streaming setting still launches with androidH264 on —
    // the equivalent of --plugin-xenon-streaming=\'{"androidH264":true}\'.
    const doc = yaml.load(buildConfigYaml(makeProfile())) as any;
    expect(doc.server.plugin.xenon.streaming).toEqual({ androidH264: true });
  });

  it('lets a profile override the streaming default (disable, or pick the source)', () => {
    const off = yaml.load(
      buildConfigYaml(makeProfile({ settings: { streaming: { androidH264: false } } }))
    ) as any;
    expect(off.server.plugin.xenon.streaming.androidH264).toBe(false);

    const sr = yaml.load(
      buildConfigYaml(makeProfile({ settings: { streaming: { androidH264: { source: 'screenrecord' } } } }))
    ) as any;
    expect(sr.server.plugin.xenon.streaming.androidH264).toEqual({ source: 'screenrecord' });
  });
});

describe('buildLaunchPlan', () => {
  it('builds argv pointing at the generated config and sets APPIUM_HOME', () => {
    const plan = buildLaunchPlan(makeProfile(), {
      appiumHome: '/tmp/ah',
      configYamlPath: '/tmp/launch/p1.yaml',
      secretValues: {}
    });
    expect(plan.command).toBe('appium');
    expect(plan.args).toEqual(['server', '--config', '/tmp/launch/p1.yaml']);
    expect(plan.env.APPIUM_HOME).toBe('/tmp/ah');
  });

  it('bridges authDisabled=true to XENON_AUTH_DISABLED env (plugin arg alone is a no-op)', () => {
    const on = buildLaunchPlan(makeProfile({ settings: { platform: 'android', authDisabled: true } }), {
      appiumHome: '/tmp/ah',
      configYamlPath: '/tmp/p.yaml',
      secretValues: {}
    });
    expect(on.env.XENON_AUTH_DISABLED).toBe('true');

    // Not set when authDisabled is false/absent.
    const off = buildLaunchPlan(makeProfile({ settings: { platform: 'android' } }), {
      appiumHome: '/tmp/ah',
      configYamlPath: '/tmp/p.yaml',
      secretValues: {}
    });
    expect(off.env.XENON_AUTH_DISABLED).toBeUndefined();
  });

  it('lets an explicit profile env var override the settings-derived bridge', () => {
    const p = makeProfile({ settings: { platform: 'android', authDisabled: true }, env: { XENON_AUTH_DISABLED: 'false' } });
    const plan = buildLaunchPlan(p, { appiumHome: '/tmp/ah', configYamlPath: '/tmp/p.yaml', secretValues: {} });
    expect(plan.env.XENON_AUTH_DISABLED).toBe('false'); // explicit profile.env wins over the bridge
  });

  it('merges profile env vars, with secrets winning over same-named plain vars', () => {
    const p = makeProfile({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318', XENON_HUB_TOKEN: 'plain' },
      secretRefs: ['XENON_HUB_TOKEN']
    });
    const plan = buildLaunchPlan(p, {
      appiumHome: '/tmp/ah',
      configYamlPath: '/tmp/p.yaml',
      secretValues: { XENON_HUB_TOKEN: 'secret-wins' }
    });
    expect(plan.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://otel:4318');
    expect(plan.env.XENON_HUB_TOKEN).toBe('secret-wins'); // secret overrides the plain env var
  });

  it('injects only referenced secrets that have a value, into env (not the spec values)', () => {
    const p = makeProfile({ secretRefs: ['XENON_GEMINI_API_KEY', 'XENON_HUB_TOKEN'] });
    const plan = buildLaunchPlan(p, {
      appiumHome: '/tmp/ah',
      configYamlPath: '/tmp/p.yaml',
      secretValues: { XENON_GEMINI_API_KEY: 'abc' } // HUB_TOKEN intentionally missing
    });
    expect(plan.env.XENON_GEMINI_API_KEY).toBe('abc');
    expect(plan.env.XENON_HUB_TOKEN).toBeUndefined();
    // The renderer-safe spec exposes key names but never values.
    expect(plan.spec.envKeys).toContain('XENON_GEMINI_API_KEY');
    expect(JSON.stringify(plan.spec)).not.toContain('abc');
  });
});

/** An installed plugin's option list that knows only the named keys. */
function schemaWith(...keys: string[]): XenonSchema {
  return { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, {}])) } as unknown as XenonSchema;
}

const ctx = { appiumHome: '/tmp/ah', configYamlPath: '/tmp/p.yaml', secretValues: {} };

describe('buildLaunchPlan with the installed option list', () => {
  it('leaves out a setting the installed Xenon does not know and reports it', () => {
    const p = makeProfile({ settings: { platform: 'android', sessionMetrics: true } });
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform', 'streaming') });
    const doc = yaml.load(plan.spec.configYaml) as any;
    expect(doc.server.plugin.xenon.platform).toBe('android');
    expect('sessionMetrics' in doc.server.plugin.xenon).toBe(false);
    expect(plan.skippedSettings).toEqual(['sessionMetrics']);
  });

  it('keeps every setting the installed Xenon knows, and reports nothing', () => {
    const p = makeProfile({ settings: { platform: 'android', maxSessions: 4 } });
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform', 'maxSessions', 'streaming') });
    const doc = yaml.load(plan.spec.configYaml) as any;
    expect(doc.server.plugin.xenon).toEqual({ platform: 'android', maxSessions: 4, streaming: { androidH264: true } });
    expect(plan.skippedSettings).toEqual([]);
  });

  it('drops an app default the installed Xenon does not know without reporting it', () => {
    const p = makeProfile({ settings: { platform: 'android' } });
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform') });
    const doc = yaml.load(plan.spec.configYaml) as any;
    expect('streaming' in doc.server.plugin.xenon).toBe(false);
    expect(plan.skippedSettings).toEqual([]);
  });

  it('reports a streaming value the profile set itself when the installed Xenon lacks it', () => {
    const p = makeProfile({ settings: { platform: 'android', streaming: { androidH264: false } } });
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform') });
    expect(plan.skippedSettings).toEqual(['streaming']);
  });

  it('drops required defaults the installed Xenon does not list among its options', () => {
    const p = makeProfile({ settings: { platform: 'android' } });
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform'), requiredDefaults: { maxSessions: 8 } });
    const doc = yaml.load(plan.spec.configYaml) as any;
    expect('maxSessions' in doc.server.plugin.xenon).toBe(false);
    expect(plan.skippedSettings).toEqual([]);
  });

  it('does not report empty values or secret-bearing settings it would not have written anyway', () => {
    const p = makeProfile({
      settings: { platform: 'android', sessionMetrics: '', hub: undefined, geminiApiKey: 'SECRET' }
    });
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform') });
    expect(plan.skippedSettings).toEqual([]);
  });

  it('does not report a hub that is blank after trimming, which is treated as unset', () => {
    const p = makeProfile({ settings: { platform: 'android', hub: '   ' } });
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform') });
    expect(plan.skippedSettings).toEqual([]);
    expect('hub' in (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon).toBe(false);
  });

  it('does not report a retired setting as skipped, whether or not the installed Xenon lists it', () => {
    const p = makeProfile({ settings: { platform: 'android', databaseProvider: 'postgresql' } });
    expect(buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform') }).skippedSettings).toEqual([]);
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform', 'databaseProvider') });
    expect(plan.skippedSettings).toEqual([]);
    expect('databaseProvider' in (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon).toBe(false);
  });

  it('lists skipped settings in the order the profile holds them', () => {
    const p = makeProfile({ settings: { zeta: 1, platform: 'android', alpha: 2 } });
    const plan = buildLaunchPlan(p, { ...ctx, schema: schemaWith('platform') });
    expect(plan.skippedSettings).toEqual(['zeta', 'alpha']);
  });

  it('behaves as before when no option list is given', () => {
    const p = makeProfile({ settings: { platform: 'android', sessionMetrics: true } });
    const plan = buildLaunchPlan(p, ctx);
    const doc = yaml.load(plan.spec.configYaml) as any;
    expect(doc.server.plugin.xenon.sessionMetrics).toBe(true);
    expect(doc.server.plugin.xenon.streaming).toEqual({ androidH264: true });
    expect(plan.skippedSettings).toEqual([]);
  });

  it('prunes the exported config the same way', () => {
    const p = makeProfile({ settings: { platform: 'android', sessionMetrics: true } });
    const doc = yaml.load(buildConfigYaml(p, {}, schemaWith('platform'))) as any;
    expect(doc.server.plugin.xenon).toEqual({ platform: 'android' });
  });
});

describe('skippedSettingsLine', () => {
  it('is null when nothing was skipped', () => {
    expect(skippedSettingsLine([])).toBeNull();
  });

  it('names one skipped setting', () => {
    expect(skippedSettingsLine(['sessionMetrics'])).toBe(
      `Skipped 1 setting your installed Xenon doesn't support: ${humanize('sessionMetrics')}.`
    );
  });

  it('names several, pluralised', () => {
    expect(skippedSettingsLine(['sessionMetrics', 'enableJsonLogging'])).toBe(
      `Skipped 2 settings your installed Xenon doesn't support: ${humanize('sessionMetrics')}, ${humanize('enableJsonLogging')}.`
    );
  });
});

// Fake values only: a real key or password must never reach a test's output.
const CLOUD_KEY = 'k-test-123';
const PROXY_PASSWORD = 'p@ss:w/rd';
const PROXY_URL = 'http://qa:p%40ss%3Aw%2Frd@squid.lab:3128';
const LOOPBACK = 'localhost,127.0.0.1,::1,.localhost';

/** A profile that reaches a cloud provider through a proxy that needs a password. */
function cloudAndProxyProfile(overrides: Partial<Profile> = {}): Profile {
  return makeProfile({
    settings: {
      platform: 'android',
      cloud: { cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub', username: 'qa-user' },
      proxy: { host: 'squid.lab', port: 3128, auth: { username: 'qa' } }
    },
    ...overrides
  });
}

const withSecrets = { ...ctx, secretValues: { CLOUD_KEY, PROXY_PASSWORD } };

describe('buildLaunchPlan: the cloud key and the proxy password', () => {
  it('writes no key, password or user name under cloud or proxy, and no proxy when its password comes from the Keychain', () => {
    const plan = buildLaunchPlan(cloudAndProxyProfile(), withSecrets);
    const xenon = (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon;
    expect(xenon.cloud).toEqual({ cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub' });
    expect('proxy' in xenon).toBe(false);
    // The log filters name `password` and `apiKey`, so the names are looked for in Xenon's settings alone.
    expect(JSON.stringify(xenon)).not.toMatch(/apiKey|password|username/);
    expect(plan.spec.configYaml).not.toMatch(/qa-user|k-test-123|p@ss|p%40ss/);
  });

  it('passes the cloud key and user name, and the proxy under every name Xenon reads, but never PROXY_PASSWORD', () => {
    const { env } = buildLaunchPlan(cloudAndProxyProfile(), withSecrets);
    expect(env.CLOUD_KEY).toBe(CLOUD_KEY);
    expect(env.CLOUD_USERNAME).toBe('qa-user');
    expect(env.HTTP_PROXY).toBe(PROXY_URL);
    expect(env.HTTPS_PROXY).toBe(PROXY_URL);
    // Xenon reads the lower-case names first (src/helpers/outboundProxy.ts schemeProxy).
    expect(env.http_proxy).toBe(PROXY_URL);
    expect(env.https_proxy).toBe(PROXY_URL);
    expect('PROXY_PASSWORD' in env).toBe(false);
  });

  it('lists the names of what it passes, never the values', () => {
    const plan = buildLaunchPlan(cloudAndProxyProfile(), withSecrets);
    expect(plan.spec.envKeys).toEqual(
      expect.arrayContaining(['CLOUD_KEY', 'CLOUD_USERNAME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'])
    );
    expect(plan.spec.envKeys).not.toContain('PROXY_PASSWORD');
    expect(JSON.stringify(plan.spec)).not.toMatch(/k-test-123|p@ss|p%40ss/);
  });

  it('keeps a proxy without a password as the proxy option, and passes no proxy variables', () => {
    const p = makeProfile({ settings: { platform: 'android', proxy: { host: 'squid.lab', port: 3128, auth: { username: 'qa' } } } });
    const plan = buildLaunchPlan(p, ctx);
    const xenon = (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon;
    expect(xenon.proxy).toEqual({ host: 'squid.lab', port: 3128, auth: { username: 'qa' } });
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
      expect(name in plan.env).toBe(false);
    }
  });

  it('uses the profile’s own key and password whether or not secretRefs names them (R54)', () => {
    for (const secretRefs of [[], ['CLOUD_KEY', 'PROXY_PASSWORD']] as Profile['secretRefs'][]) {
      const { env } = buildLaunchPlan(cloudAndProxyProfile({ secretRefs }), withSecrets);
      expect(env.CLOUD_KEY).toBe(CLOUD_KEY);
      expect(env.HTTP_PROXY).toBe(PROXY_URL);
    }
  });

  it('keeps the proxy option when the profile has no proxy password saved', () => {
    const plan = buildLaunchPlan(cloudAndProxyProfile(), ctx);
    const xenon = (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon;
    expect(xenon.proxy).toEqual({ host: 'squid.lab', port: 3128, auth: { username: 'qa' } });
    expect('HTTP_PROXY' in plan.env).toBe(false);
  });

  it('keeps the proxy option, without the password, when no address can be made from it (no user name)', () => {
    const p = cloudAndProxyProfile({
      settings: { platform: 'android', proxy: { host: 'squid.lab', port: 3128, auth: { password: PROXY_PASSWORD } } }
    });
    const plan = buildLaunchPlan(p, withSecrets);
    const xenon = (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon;
    expect(xenon.proxy).toEqual({ host: 'squid.lab', port: 3128, auth: {} });
    expect('HTTP_PROXY' in plan.env).toBe(false);
    expect('PROXY_PASSWORD' in plan.env).toBe(false);
    expect(JSON.stringify(plan)).not.toMatch(/p@ss|p%40ss/);
  });

  it('lets the proxy win over the same names in the profile’s env, in either case', () => {
    const p = cloudAndProxyProfile({
      env: { HTTP_PROXY: 'http://other:1', HTTPS_PROXY: 'http://other:2', http_proxy: 'http://other:3', https_proxy: 'http://other:4' }
    });
    const { env } = buildLaunchPlan(p, withSecrets);
    expect([env.HTTP_PROXY, env.HTTPS_PROXY, env.http_proxy, env.https_proxy]).toEqual([PROXY_URL, PROXY_URL, PROXY_URL, PROXY_URL]);
  });

  it('uses a password the profile still holds when the Keychain has none for it (one that could not move)', () => {
    const p = makeProfile({
      settings: { platform: 'android', proxy: { host: 'squid.lab', port: 3128, auth: { username: 'qa', password: PROXY_PASSWORD } } }
    });
    const plan = buildLaunchPlan(p, ctx);
    expect('proxy' in (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon).toBe(false);
    expect(plan.env.HTTPS_PROXY).toBe(PROXY_URL);
    expect(plan.spec.configYaml).not.toMatch(/p@ss|p%40ss/);
  });

  it('prefers the Keychain password to one the profile still holds', () => {
    const p = cloudAndProxyProfile({
      settings: { platform: 'android', proxy: { host: 'squid.lab', port: 3128, auth: { username: 'qa', password: 'p-held-1' } } }
    });
    expect(buildLaunchPlan(p, withSecrets).env.HTTP_PROXY).toBe(PROXY_URL);
  });

  it('never passes the Keychain proxy password under its own name, even with no proxy set', () => {
    const p = makeProfile();
    const plan = buildLaunchPlan(p, { ...ctx, secretValues: { PROXY_PASSWORD } });
    expect('PROXY_PASSWORD' in plan.env).toBe(false);
    expect(JSON.stringify(plan)).not.toMatch(/p@ss/);
  });

  it('passes no CLOUD_USERNAME without a cloud user name, and lets the profile’s own env var win', () => {
    for (const cloud of [{ cloudName: 'x' }, { cloudName: 'x', username: '  ' }, 'x', null]) {
      const p = makeProfile({ settings: { platform: 'android', cloud } });
      expect('CLOUD_USERNAME' in buildLaunchPlan(p, ctx).env).toBe(false);
    }
    const p = cloudAndProxyProfile({ env: { CLOUD_USERNAME: 'explicit' } });
    expect(buildLaunchPlan(p, withSecrets).env.CLOUD_USERNAME).toBe('explicit');
  });

  it('leaves out a cloud setting that held only a key', () => {
    const p = makeProfile({ settings: { platform: 'android', cloud: { apiKey: CLOUD_KEY } } });
    const plan = buildLaunchPlan(p, ctx);
    expect('cloud' in (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon).toBe(false);
    expect(JSON.stringify(plan.spec)).not.toContain(CLOUD_KEY);
  });
});

describe('buildLaunchPlan: loopback goes direct when the proxy is passed in the environment', () => {
  it('adds the loopback hosts to NO_PROXY and no_proxy', () => {
    const { env } = buildLaunchPlan(cloudAndProxyProfile(), withSecrets);
    expect(env.NO_PROXY).toBe(LOOPBACK);
    expect(env.no_proxy).toBe(LOOPBACK);
  });

  it('keeps the hosts the profile names, the lower-case name first as Xenon reads it, each host once', () => {
    const upper = buildLaunchPlan(cloudAndProxyProfile({ env: { NO_PROXY: '.lab.example,localhost' } }), withSecrets).env;
    expect(upper.NO_PROXY).toBe(`.lab.example,${LOOPBACK}`);
    expect(upper.no_proxy).toBe(`.lab.example,${LOOPBACK}`);
    const lower = buildLaunchPlan(
      cloudAndProxyProfile({ env: { NO_PROXY: 'upper.example', no_proxy: 'lower.example' } }),
      withSecrets
    ).env;
    expect(lower.NO_PROXY).toBe(`lower.example,${LOOPBACK}`);
    expect(lower.no_proxy).toBe(`lower.example,${LOOPBACK}`);
  });

  it('takes the inherited NO_PROXY when the profile names none, and the profile’s over it', () => {
    const inherited = { ...withSecrets, inheritedEnv: { NO_PROXY: 'corp.example' } };
    expect(buildLaunchPlan(cloudAndProxyProfile(), inherited).env.NO_PROXY).toBe(`corp.example,${LOOPBACK}`);
    const lowerInherited = { ...withSecrets, inheritedEnv: { no_proxy: 'low.example', NO_PROXY: 'up.example' } };
    expect(buildLaunchPlan(cloudAndProxyProfile(), lowerInherited).env.no_proxy).toBe(`low.example,${LOOPBACK}`);
    const own = buildLaunchPlan(cloudAndProxyProfile({ env: { NO_PROXY: 'own.example' } }), inherited).env;
    expect(own.NO_PROXY).toBe(`own.example,${LOOPBACK}`);
  });

  it('leaves NO_PROXY alone when the proxy stays an option', () => {
    const p = makeProfile({
      settings: { platform: 'android', proxy: { host: 'squid.lab', auth: { username: 'qa' } } },
      env: { NO_PROXY: '.lab.example' }
    });
    const { env } = buildLaunchPlan(p, { ...ctx, inheritedEnv: { NO_PROXY: 'corp.example' } });
    expect(env.NO_PROXY).toBe('.lab.example');
    expect('no_proxy' in env).toBe(false);
  });
});

describe('the preview and Export Config with a draft that still holds the secrets', () => {
  // The renderer's draft keeps a value main has moved to the Keychain until the profile is opened again.
  const staleDraft = makeProfile({
    settings: {
      platform: 'android',
      cloud: { cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub', username: 'qa-user', apiKey: CLOUD_KEY },
      proxy: { host: 'squid.lab', port: 3128, auth: { username: 'qa', password: PROXY_PASSWORD } }
    }
  });

  it('shows neither value in the preview, which reveals no secret', () => {
    const plan = buildLaunchPlan(staleDraft, ctx);
    expect(JSON.stringify(plan.spec)).not.toMatch(/k-test-123|p@ss|p%40ss|qa-user/);
  });

  it('exports the proxy without its password and the cloud without its key or user name', () => {
    const text = buildConfigYaml(staleDraft, {}, schemaWith('platform', 'cloud', 'proxy'));
    const xenon = (yaml.load(text) as any).server.plugin.xenon;
    expect(xenon.proxy).toEqual({ host: 'squid.lab', port: 3128, auth: { username: 'qa' } });
    expect(xenon.cloud).toEqual({ cloudName: 'lambdatest', url: 'https://hub.lambdatest.example/wd/hub' });
    expect(text).not.toMatch(/k-test-123|p@ss|p%40ss|qa-user/);
  });
});

describe('the bundled option list', () => {
  it('does not make Appium demand a cloud key: cloud has no $ref and no required', () => {
    // The bundled list is a byte-for-byte copy of the repo's schema.json (npm run sync:schema).
    const bundled = readRepoSchema() as unknown as { properties: Record<string, Record<string, unknown>> };
    const cloud = bundled.properties.cloud;
    expect(cloud).toBeDefined();
    expect('$ref' in cloud).toBe(false);
    expect('required' in cloud).toBe(false);
  });
});

describe('buildLaunchPlan: the cloud key is the profile’s own (R54; R42b is gone)', () => {
  const holding = (overrides: Partial<Profile> = {}) =>
    makeProfile({ settings: { platform: 'android', cloud: { cloudName: 'lambdatest', apiKey: CLOUD_KEY } }, ...overrides });

  it('never passes or writes a key left in the cloud settings: a profile never keeps one', () => {
    const plan = buildLaunchPlan(holding(), ctx);
    expect('CLOUD_KEY' in plan.env).toBe(false);
    expect(plan.spec.configYaml).not.toContain(CLOUD_KEY);
    expect(JSON.stringify(plan.spec)).not.toContain(CLOUD_KEY);
  });

  it('passes the profile’s own saved key, which wins over a CLOUD_KEY variable of the profile’s', () => {
    expect(buildLaunchPlan(holding(), { ...ctx, secretValues: { CLOUD_KEY: 'k-keychain-1' } }).env.CLOUD_KEY).toBe('k-keychain-1');
    const both = buildLaunchPlan(holding({ env: { CLOUD_KEY: 'k-env-1' } }), { ...ctx, secretValues: { CLOUD_KEY: 'k-keychain-1' } });
    expect(both.env.CLOUD_KEY).toBe('k-keychain-1');
    expect(buildLaunchPlan(holding({ env: { CLOUD_KEY: 'k-env-1' } }), ctx).env.CLOUD_KEY).toBe('k-env-1');
  });

  it('lists CLOUD_KEY among the names the preview shows, never its value', () => {
    const plan = buildLaunchPlan(makeProfile(), { ...ctx, secretValues: { CLOUD_KEY } });
    expect(plan.spec.envKeys).toContain('CLOUD_KEY');
    expect(JSON.stringify(plan.spec)).not.toContain(CLOUD_KEY);
  });
});

describe('a proxy written as a string (R44)', () => {
  const withProxy = (proxy: unknown, overrides: Partial<Profile> = {}) =>
    makeProfile({ settings: { platform: 'android', proxy }, ...overrides });

  it('passes one holding a password in the environment, and writes no proxy', () => {
    const plan = buildLaunchPlan(withProxy(PROXY_URL), ctx);
    expect(plan.env.HTTP_PROXY).toBe(PROXY_URL);
    expect(plan.env.https_proxy).toBe(PROXY_URL);
    expect(plan.env.NO_PROXY).toBe(LOOPBACK);
    expect('proxy' in (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon).toBe(false);
    expect(JSON.stringify(plan.spec)).not.toMatch(/p@ss|p%40ss/);
  });

  it('puts the Keychain password into one that names only its user', () => {
    const p = withProxy('http://qa@squid.lab:3128');
    const plan = buildLaunchPlan(p, { ...ctx, secretValues: { PROXY_PASSWORD } });
    expect(plan.env.HTTPS_PROXY).toBe(PROXY_URL);
    expect('PROXY_PASSWORD' in plan.env).toBe(false);
  });

  it('keeps one without a password as the proxy option, without credentials', () => {
    const plain = buildLaunchPlan(withProxy('http://squid.lab:3128'), ctx);
    expect((yaml.load(plain.spec.configYaml) as any).server.plugin.xenon.proxy).toBe('http://squid.lab:3128');
    expect('HTTP_PROXY' in plain.env).toBe(false);
  });

  it('exports it without its credentials', () => {
    const text = buildConfigYaml(withProxy(PROXY_URL));
    expect((yaml.load(text) as any).server.plugin.xenon.proxy).toBe('http://squid.lab:3128');
    expect(text).not.toMatch(/p@ss|p%40ss|qa:/);
  });
});

describe('a proxy written as a string with a password and no user name (R44)', () => {
  const USERLESS_URL = 'http://:p%40ss%3Aw%2Frd@squid.lab:3128';
  const withProxy = (proxy: unknown) => makeProfile({ settings: { platform: 'android', proxy } });

  it.each([USERLESS_URL, ':p%40ss%3Aw%2Frd@squid.lab:3128'])('passes %j in the environment, and no file or reply holds the password', (proxy) => {
    const plan = buildLaunchPlan(withProxy(proxy), ctx);
    expect(plan.env.HTTP_PROXY).toBe(USERLESS_URL);
    expect(plan.env.https_proxy).toBe(USERLESS_URL);
    expect('proxy' in (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon).toBe(false);
    expect(JSON.stringify(plan.spec)).not.toMatch(/p@ss|p%40ss/);
    expect(buildConfigYaml(withProxy(proxy))).not.toMatch(/p@ss|p%40ss/);
  });

  it('puts the Keychain password back into the address the move left', () => {
    const p = makeProfile({ settings: { platform: 'android', proxy: 'http://squid.lab:3128' } });
    expect(buildLaunchPlan(p, { ...ctx, secretValues: { PROXY_PASSWORD } }).env.HTTP_PROXY).toBe(USERLESS_URL);
  });

  it('exports the schemeless one as its host and port', () => {
    const text = buildConfigYaml(withProxy(':p%40ss%3Aw%2Frd@squid.lab:3128'));
    expect((yaml.load(text) as any).server.plugin.xenon.proxy).toBe('squid.lab:3128');
  });
});

describe('the cloud addresses never carry a user name or key into a file (R55)', () => {
  const withCredentials = makeProfile({
    settings: {
      platform: 'android',
      cloud: {
        cloudName: 'browserstack',
        url: 'https://qa-user:k-test-9@hub-cloud.browserstack.example/wd/hub',
        apiUrl: 'https://qa-user:k-test-9@api.browserstack.example'
      }
    }
  });

  it('cuts them from the launch config and the preview, and keeps the addresses', () => {
    const plan = buildLaunchPlan(withCredentials, ctx);
    const xenon = (yaml.load(plan.spec.configYaml) as any).server.plugin.xenon;
    expect(xenon.cloud).toEqual({
      cloudName: 'browserstack',
      url: 'https://hub-cloud.browserstack.example/wd/hub',
      apiUrl: 'https://api.browserstack.example'
    });
    expect(JSON.stringify(plan.spec)).not.toMatch(/k-test-9|qa-user/);
  });

  it('cuts them from Export Config', () => {
    const text = buildConfigYaml(withCredentials, {}, schemaWith('platform', 'cloud'));
    expect(text).toContain('hub-cloud.browserstack.example');
    expect(text).not.toMatch(/k-test-9|qa-user/);
  });
});
