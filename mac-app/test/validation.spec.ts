import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/renderer/src/validation';
import type { Profile, XenonSchema } from '../src/shared/types';

const schema = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'schema.json'), 'utf8')
) as XenonSchema;

function profileWithHub(hub: string): Profile {
  return {
    id: 'p1',
    name: 'Test',
    settings: { platform: 'both', hub },
    server: { port: 4723, basePath: '/wd/hub', appiumHome: '', keepAliveTimeout: 800 },
    secretRefs: [],
    env: {},
    createdAt: 0,
    updatedAt: 0
  };
}

const hubIssues = (hub: string) => validate(schema, profileWithHub(hub)).filter((i) => i.path === 'hub');

describe('hub address', () => {
  it.each(['http://hub-mac:4723', 'http://hub-mac:4723/', 'https://10.0.0.5'])('accepts %s', (hub) => {
    expect(hubIssues(hub)).toEqual([]);
  });

  it('treats an empty hub as standalone', () => {
    expect(hubIssues('')).toEqual([]);
    expect(hubIssues('   ')).toEqual([]);
  });

  it.each([
    'http://hub-mac:4723/wd/hub',
    'http://hub-mac:4723?x=1',
    'http://hub-mac:4723/#a',
    // A URL parser drops a bare ? or #, so these only fail on the raw string.
    'http://hub-mac:4723?',
    'http://hub-mac:4723/#',
    'ftp://hub',
    'hub-mac:4723',
    // The hub is only an address: a user name or password in it would go into the saved profile and exports.
    'http://u:p@hub:4723',
    'http://u@hub:4723',
    'http://:p@hub:4723',
    'https://u:p@hub-mac'
  ])('rejects %s with the origin-only message', (hub) => {
    const issues = hubIssues(hub);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe(
      "Use only the hub's address, like http://hub-mac:4723, without /wd/hub or other paths."
    );
  });
});
