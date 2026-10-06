import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { buildConfigYaml, buildLaunchPlan, skippedSettingsLine } from '../src/main/LaunchBuilder';
import { humanize } from '../src/shared/humanize';
import type { Profile, XenonSchema } from '../src/shared/types';

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
