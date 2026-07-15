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
