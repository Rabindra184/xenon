import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PLUGIN_MARKER, pluginMarkerPath } from '../src/main/toolchainRules';
import { NPM_PLUGIN } from '../src/main/setupPlan';

// The probe that decides whether an APPIUM_HOME "has the plugin". It feeds
// pickAppiumHome, so getting it wrong changes which home the launcher runs the
// server from — not merely a label. The plugin installs as the SCOPED package
// (@xenon-device-management/xenon); an unscoped `node_modules/xenon` is an
// unrelated public npm package that older setups left behind.

const created: string[] = [];

/** A temp APPIUM_HOME containing whichever node_modules entries are requested. */
function makeHome(entries: string[]): string {
  const home = mkdtempSync(path.join(tmpdir(), 'xenon-marker-'));
  created.push(home);
  for (const entry of entries) {
    mkdirSync(path.join(home, 'node_modules', entry), { recursive: true });
  }
  return home;
}

afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('pluginMarkerPath', () => {
  it('points at the scoped package, matching how the plugin is installed', () => {
    expect(pluginMarkerPath('/a/home')).toBe(path.join('/a/home', 'node_modules', NPM_PLUGIN));
  });

  it('derives the marker from NPM_PLUGIN so the two cannot drift apart', () => {
    expect(path.join(...PLUGIN_MARKER)).toBe(path.join('node_modules', NPM_PLUGIN));
  });
});

describe('plugin presence probe', () => {
  it('detects a home that has the real (scoped) install', () => {
    const home = makeHome([NPM_PLUGIN]);
    expect(existsSync(pluginMarkerPath(home))).toBe(true);
  });

  it('does NOT count a stale legacy unscoped `node_modules/xenon` as the plugin', () => {
    const home = makeHome(['xenon']);
    expect(existsSync(pluginMarkerPath(home))).toBe(false);
  });

  it('detects the scoped install even when a legacy unscoped dir is also present', () => {
    const home = makeHome(['xenon', NPM_PLUGIN]);
    expect(existsSync(pluginMarkerPath(home))).toBe(true);
  });

  it('reports absent for a home with neither', () => {
    const home = makeHome([]);
    expect(existsSync(pluginMarkerPath(home))).toBe(false);
  });
});
