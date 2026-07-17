import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readInstalledPluginVersion } from '../src/main/installedPluginVersion';
import { NPM_PLUGIN } from '../src/main/setupPlan';

const created: string[] = [];

function makeAppiumHome(pkg?: Record<string, unknown>): string {
  const home = mkdtempSync(path.join(tmpdir(), 'xenon-home-'));
  created.push(home);
  if (pkg) {
    const dir = path.join(home, 'node_modules', NPM_PLUGIN);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  }
  return home;
}

afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('readInstalledPluginVersion', () => {
  it('reads the installed plugin version from APPIUM_HOME', () => {
    const home = makeAppiumHome({ name: NPM_PLUGIN, version: '1.7.3' });
    expect(readInstalledPluginVersion(home)).to.equal('1.7.3');
  });

  it('returns null when the plugin is not installed', () => {
    expect(readInstalledPluginVersion(makeAppiumHome())).to.equal(null);
  });

  it('returns null for an empty APPIUM_HOME', () => {
    expect(readInstalledPluginVersion('')).to.equal(null);
  });

  it('returns null when package.json has no version field', () => {
    const home = makeAppiumHome({ name: NPM_PLUGIN });
    expect(readInstalledPluginVersion(home)).to.equal(null);
  });
});
