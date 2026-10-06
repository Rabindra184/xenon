import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { XENON_LOG_FILTERS } from '../src/main/logFilters';
import { buildConfigYaml } from '../src/main/LaunchBuilder';
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

const docRules = () => {
  const md = readFileSync(resolve(__dirname, '../../website/docs/authentication.md'), 'utf8');
  const block = md.match(/```yaml\n(server:\n  log-filters:[\s\S]*?)```/)![1];
  return (yaml.load(block) as any).server['log-filters'];
};
const apply = (line: string) =>
  XENON_LOG_FILTERS.reduce((t, r) => t.replace(new RegExp(r.pattern, r.flags), r.replacer), line);

describe('XENON_LOG_FILTERS', () => {
  it('matches the rules documented in authentication.md', () => {
    expect(XENON_LOG_FILTERS).toEqual(docRules());
  });
  it('redacts a session token, a password, an apiKey and a lease token', () => {
    expect(apply('{"alwaysMatch":{"xe:token":"eyJhbGciOi.abc-123","platformName":"Android"}}'))
      .toBe('{"alwaysMatch":{"xe:token":"**REDACTED**","platformName":"Android"}}');
    expect(apply('{"email":"qa@lab.test","password":"s3cr\\"et!"}'))
      .toBe('{"email":"qa@lab.test","password":"**REDACTED**"}');
    expect(apply("cloud: { apiKey: 'k-123-xyz', url: 'https://x' }"))
      .toBe("cloud: { apiKey: '**REDACTED**', url: 'https://x' }");
    expect(apply('{"leaseToken":"lt_9f8e","udid":"emulator-5554"}'))
      .toBe('{"leaseToken":"**REDACTED**","udid":"emulator-5554"}');
  });
});

describe('buildConfigYaml log-filters', () => {
  it('writes both rules under server and they survive the YAML round trip', () => {
    const doc = yaml.load(buildConfigYaml(makeProfile())) as any;
    expect(doc.server['log-filters']).toEqual(XENON_LOG_FILTERS);
  });
});
