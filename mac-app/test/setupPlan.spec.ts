import { describe, expect, it } from 'vitest';
import {
  NPM_PLUGIN,
  PLUGIN_NAME,
  partitionDrivers,
  planPluginSteps,
} from '../src/main/setupPlan';

const REPO = '/Users/me/Workspace/xenon';

describe('planPluginSteps — npm source', () => {
  it('fresh install when not installed', () => {
    const plan = planPluginSteps({ installedName: null, pluginSource: 'npm', repoRoot: null });
    expect(plan.effectiveSource).toBe('npm');
    expect(plan.fallbackToNpm).toBe(false);
    expect(plan.steps).toEqual([
      { step: 'install-plugin', args: ['plugin', 'install', '--source=npm', NPM_PLUGIN] },
    ]);
  });

  it('updates instead of reinstalling when already installed (F3)', () => {
    const plan = planPluginSteps({ installedName: 'xenon', pluginSource: 'npm', repoRoot: null });
    expect(plan.steps).toEqual([{ step: 'update-plugin', args: ['plugin', 'update', 'xenon'] }]);
  });

  it('updates using the detected registered name, not a hardcoded one', () => {
    const plan = planPluginSteps({ installedName: 'xenon-custom', pluginSource: 'npm', repoRoot: null });
    expect(plan.steps).toEqual([
      { step: 'update-plugin', args: ['plugin', 'update', 'xenon-custom'] },
    ]);
  });
});

describe('planPluginSteps — local source with a repo', () => {
  it('installs from the local checkout when not installed', () => {
    const plan = planPluginSteps({ installedName: null, pluginSource: 'local', repoRoot: REPO });
    expect(plan.effectiveSource).toBe('local');
    expect(plan.fallbackToNpm).toBe(false);
    expect(plan.steps).toEqual([
      { step: 'install-plugin', args: ['plugin', 'install', '--source=local', REPO] },
    ]);
  });

  it('reinstalls (uninstall + install) from local when already installed', () => {
    const plan = planPluginSteps({ installedName: 'xenon', pluginSource: 'local', repoRoot: REPO });
    expect(plan.steps).toEqual([
      { step: 'uninstall-plugin', args: ['plugin', 'uninstall', 'xenon'] },
      { step: 'install-plugin', args: ['plugin', 'install', '--source=local', REPO] },
    ]);
  });
});

describe('planPluginSteps — local requested but no repo (F2 packaged-app case)', () => {
  it('falls back to an npm install when not installed', () => {
    const plan = planPluginSteps({ installedName: null, pluginSource: 'local', repoRoot: null });
    expect(plan.effectiveSource).toBe('npm');
    expect(plan.fallbackToNpm).toBe(true);
    expect(plan.steps).toEqual([
      { step: 'install-plugin', args: ['plugin', 'install', '--source=npm', NPM_PLUGIN] },
    ]);
  });

  it('falls back to an npm update when already installed', () => {
    const plan = planPluginSteps({ installedName: 'xenon', pluginSource: 'local', repoRoot: null });
    expect(plan.effectiveSource).toBe('npm');
    expect(plan.fallbackToNpm).toBe(true);
    expect(plan.steps).toEqual([{ step: 'update-plugin', args: ['plugin', 'update', 'xenon'] }]);
  });

  it('never emits a local step without a repo path', () => {
    const plan = planPluginSteps({ installedName: null, pluginSource: 'local', repoRoot: null });
    for (const s of plan.steps) {
      expect(s.args).not.toContain('--source=local');
    }
  });
});

describe('partitionDrivers', () => {
  it('installs only drivers that are missing and skips installed ones', () => {
    expect(partitionDrivers(['uiautomator2', 'xcuitest'], ['uiautomator2'])).toEqual({
      toInstall: ['xcuitest'],
      skip: ['uiautomator2'],
    });
  });

  it('installs all when none present', () => {
    expect(partitionDrivers(['uiautomator2', 'xcuitest'], [])).toEqual({
      toInstall: ['uiautomator2', 'xcuitest'],
      skip: [],
    });
  });

  it('skips all when everything is already present', () => {
    expect(partitionDrivers(['uiautomator2', 'xcuitest'], ['uiautomator2', 'xcuitest', 'espresso'])).toEqual({
      toInstall: [],
      skip: ['uiautomator2', 'xcuitest'],
    });
  });
});

describe('constants', () => {
  it('exposes the plugin name and npm package', () => {
    expect(PLUGIN_NAME).toBe('xenon');
    expect(NPM_PLUGIN).toBe('@xenon-device-management/xenon');
  });
});
