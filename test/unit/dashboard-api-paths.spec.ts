import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { createRouter } from '../../src/app/index';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { routesOf } from '../helpers/expressRoutes';

/**
 * Every address the dashboard calls must be one the server serves.
 *
 * "Assign team" called `PUT /xenon/api/grid/device/:udid/team` while the
 * server mounts that route at the API root (`/xenon/api/device/:udid/team`).
 * Nothing mounts `/grid`, so every assignment from the Devices page was a
 * 404, and the only test mocked the whole api-service, so it never saw it.
 *
 * This reads the paths the dashboard's source writes down (`/xenon/api/...`
 * literals and the `makeGETRequest('/...')` family, which the api client
 * prefixes with `/xenon/api`) and checks each against the routes the router
 * really serves.
 */

const WEB_SRC = path.resolve(__dirname, '../../web/src');
const API = '/xenon/api';

/** "/xenon/api/control/:udid/tap" and "/xenon/api/control/${udid}/tap" both -> ".../control/{}/tap" */
const shape = (p: string) =>
  p
    .replace(/\$\{[^}]*\}/g, '{}')
    .replace(/:[A-Za-z_]\w*/g, '{}')
    .replace(/\/+$/, '');

// Addresses written in the dashboard that are not served, each with why.
const KNOWN_NOT_SERVED: Record<string, string> = {
  [`${API}/session/{}/xenon/omni-scan`]:
    'XenonApiService.omniScan: an Appium plugin route, not under /xenon/api; no caller',
  [`${API}/session/{}/xenon/test-locator`]:
    'XenonApiService.testAiLocator: an Appium plugin route, not under /xenon/api; no caller',
  [`${API}/sessions`]:
    "ApiKeyGate's sign-in probe: only the 401 matters, and the login check answers before routing",
};

// Written as a base that the same file extends (`const BASE = '/xenon/api/auth'`,
// then `${BASE}/me`), so the base alone is not a route.
const BASES = [`${API}/auth`, `${API}/interceptor`, `${API}/profile`];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sources(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Each address a source file writes down, with the file it is in. */
function dashboardAddresses(): Array<{ address: string; file: string }> {
  const found: Array<{ address: string; file: string }> = [];
  for (const file of sources(WEB_SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(WEB_SRC, file);
    // '/xenon/api/...' in a string or template; not '/xenon/api-docs', nor the
    // api client's bare `/xenon/api${url}` prefix.
    for (const m of text.matchAll(/['"`]\/xenon\/api(\/[^'"`\s?]*)/g)) {
      found.push({ address: `${API}${m[1]}`, file: rel });
    }
    // apiClient.makeGETRequest('/queue') -> the client adds the prefix.
    for (const m of text.matchAll(
      /make(?:GET|POST|PUT|DELETE|PATCH)Request\(\s*['"`](\/[^'"`?]*)/g,
    )) {
      found.push({ address: `${API}${m[1]}`, file: rel });
    }
  }
  return found;
}

describe('the addresses the dashboard calls', () => {
  const served = [
    ...routesOf(
      createRouter({ ...DefaultPluginArgs, hub: 'http://hub.example:4723' } as any),
      '/xenon',
    ),
  ]
    .filter((r) => r.includes(' /xenon/api'))
    .map((r) => shape(r.slice(r.indexOf(' ') + 1)));

  const isServed = (address: string) => served.includes(shape(address));
  const isBase = (address: string) => BASES.includes(shape(address));
  const underBase = (base: string) => served.some((s) => s.startsWith(`${base}/`));

  it("finds the dashboard's addresses (the scan is not reading nothing)", () => {
    const all = dashboardAddresses();
    expect(all.length).to.be.greaterThan(60);
    expect(all.map((a) => shape(a.address))).to.include(`${API}/device/{}/team`);
  });

  it('are all served by the API router', () => {
    const missing = dashboardAddresses()
      .filter(
        ({ address }) =>
          !isServed(address) && !isBase(address) && !(shape(address) in KNOWN_NOT_SERVED),
      )
      .map(({ address, file }) => `${address}  (web/src/${file})`);
    expect([...new Set(missing)].sort(), 'called by the dashboard but not served').to.deep.equal(
      [],
    );
  });

  it('has no allowance for an address that is now served or no longer written', () => {
    const written = new Set(dashboardAddresses().map(({ address }) => shape(address)));
    const stale = [
      ...Object.keys(KNOWN_NOT_SERVED).filter((a) => isServed(a) || !written.has(a)),
      ...BASES.filter((b) => !written.has(b) || !underBase(b)),
    ];
    expect(stale, 'remove these from KNOWN_NOT_SERVED / BASES').to.deep.equal([]);
  });
});
