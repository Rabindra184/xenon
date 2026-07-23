import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { buildConfigYaml, buildLaunchPlan } from '../src/main/LaunchBuilder';
import type { Profile } from '../src/shared/types';

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
