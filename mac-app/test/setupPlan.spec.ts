import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  GO_IOS_SCRIPT,
  NPM_PLUGIN,
  PLUGIN_NAME,
  partitionDrivers,
  planGoIosStep,
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

describe('planGoIosStep', () => {
  const PLUGIN_DIR = '/home/qa/.appium/node_modules/@xenon-device-management/xenon';
  const SCRIPT = path.join(PLUGIN_DIR, 'lib', 'src', 'scripts', 'install-go-ios.js');

  it('is not needed for an android-only profile', () => {
    expect(planGoIosStep({ platform: 'android', pluginDir: PLUGIN_DIR, scriptExists: true })).toEqual({
      kind: 'not-needed',
    });
  });

  it('is not needed for android even when the script is missing', () => {
    expect(planGoIosStep({ platform: 'android', pluginDir: PLUGIN_DIR, scriptExists: false })).toEqual({
      kind: 'not-needed',
    });
  });

  it('runs the installer script for an ios profile', () => {
    expect(planGoIosStep({ platform: 'ios', pluginDir: PLUGIN_DIR, scriptExists: true })).toEqual({
      kind: 'run',
      step: { step: 'install-go-ios', args: [SCRIPT] },
    });
  });

  it('runs the installer script for a both profile', () => {
    expect(planGoIosStep({ platform: 'both', pluginDir: PLUGIN_DIR, scriptExists: true })).toEqual({
      kind: 'run',
      step: { step: 'install-go-ios', args: [SCRIPT] },
    });
  });

  it('treats an undefined platform as both', () => {
    expect(planGoIosStep({ platform: undefined, pluginDir: PLUGIN_DIR, scriptExists: true })).toEqual({
      kind: 'run',
      step: { step: 'install-go-ios', args: [SCRIPT] },
    });
  });

  it('skips with the update message when the script is missing (ios)', () => {
    expect(planGoIosStep({ platform: 'ios', pluginDir: PLUGIN_DIR, scriptExists: false })).toEqual({
      kind: 'skip',
      detail: "This Xenon version can't set up iPhones from here. Update Xenon, then run Set up again.",
    });
  });

  it('skips with the update message when the script is missing (both and undefined)', () => {
    const detail = "This Xenon version can't set up iPhones from here. Update Xenon, then run Set up again.";
    expect(planGoIosStep({ platform: 'both', pluginDir: PLUGIN_DIR, scriptExists: false })).toEqual({
      kind: 'skip',
      detail,
    });
    expect(planGoIosStep({ platform: undefined, pluginDir: PLUGIN_DIR, scriptExists: false })).toEqual({
      kind: 'skip',
      detail,
    });
  });

  it('points at lib/src/scripts/install-go-ios.js inside the plugin', () => {
    expect(GO_IOS_SCRIPT).toEqual(['lib', 'src', 'scripts', 'install-go-ios.js']);
  });
});

describe('constants', () => {
  it('exposes the plugin name and npm package', () => {
    expect(PLUGIN_NAME).toBe('xenon');
    expect(NPM_PLUGIN).toBe('@xenon-device-management/xenon');
  });
});
