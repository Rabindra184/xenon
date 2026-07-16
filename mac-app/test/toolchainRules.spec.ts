import { describe, expect, it } from 'vitest';
import {
  WDA_POOL_SIZE,
  assessWdaPressure,
  deriveAndroidHome,
  parseShellVars
} from '../src/main/toolchainRules';

describe('deriveAndroidHome', () => {
  it('prefers an explicit ANDROID_HOME', () => {
    expect(
      deriveAndroidHome({ androidHome: '/explicit/sdk', sdkRoot: '/other/sdk', adbPath: '/a/platform-tools/adb' })
    ).toBe('/explicit/sdk');
  });

  it('falls back to ANDROID_SDK_ROOT', () => {
    expect(deriveAndroidHome({ sdkRoot: '/root/sdk', adbPath: '/a/platform-tools/adb' })).toBe('/root/sdk');
  });

  it('derives the SDK root from an adb path under platform-tools', () => {
    expect(deriveAndroidHome({ adbPath: '/Users/me/Library/Android/sdk/platform-tools/adb' })).toBe(
      '/Users/me/Library/Android/sdk'
    );
  });

  it('ignores an adb that is not inside platform-tools (e.g. a shim on PATH)', () => {
    expect(deriveAndroidHome({ adbPath: '/opt/homebrew/bin/adb', defaultSdkDir: '/Users/me/Library/Android/sdk' })).toBe(
      '/Users/me/Library/Android/sdk'
    );
  });

  it('falls back to the default SDK dir, then to null', () => {
    expect(deriveAndroidHome({ defaultSdkDir: '/Users/me/Library/Android/sdk' })).toBe('/Users/me/Library/Android/sdk');
    expect(deriveAndroidHome({})).toBeNull();
  });

  it('treats blank/whitespace env values as unset', () => {
    expect(deriveAndroidHome({ androidHome: '   ', sdkRoot: '', defaultSdkDir: '/d/sdk' })).toBe('/d/sdk');
  });
});

describe('assessWdaPressure', () => {
  const base = { platform: 'both', availableSimulators: 158, bootedSimulators: false, simulatorAllowListCount: 0 };

  it('warns when available simulators exceed the WDA pool', () => {
    const res = assessWdaPressure(base);
    expect(res.status).toBe('warn');
    expect(res.detail).toContain('158');
    expect(res.detail).toContain(String(WDA_POOL_SIZE));
    expect(res.remediation).toMatch(/booted/i);
  });

  it('is ok when booted-only discovery is enabled', () => {
    expect(assessWdaPressure({ ...base, bootedSimulators: true }).status).toBe('ok');
  });

  it('is ok when an allow-list keeps the count within the pool', () => {
    expect(assessWdaPressure({ ...base, simulatorAllowListCount: 3 }).status).toBe('ok');
  });

  it('warns when the allow-list itself exceeds the pool', () => {
    expect(assessWdaPressure({ ...base, simulatorAllowListCount: 120 }).status).toBe('warn');
  });

  it('is not applicable to an Android-only profile', () => {
    const res = assessWdaPressure({ ...base, platform: 'android' });
    expect(res.status).toBe('ok');
    expect(res.detail).toMatch(/not applicable/i);
  });

  it('is ok when the simulator count fits the pool', () => {
    expect(assessWdaPressure({ ...base, availableSimulators: 12 }).status).toBe('ok');
  });
});

describe('parseShellVars', () => {
  it('extracts marked vars and drops empty ones', () => {
    const stdout = [
      'some noise from .zshrc',
      '__XENON_PATH__:/usr/bin:/bin',
      '__XENON_ANDROID_HOME__:',
      '__XENON_ANDROID_SDK_ROOT__:/Users/me/Library/Android/sdk'
    ].join('\n');
    expect(parseShellVars(stdout)).toEqual({
      PATH: '/usr/bin:/bin',
      ANDROID_SDK_ROOT: '/Users/me/Library/Android/sdk'
    });
  });

  it('returns an empty object when nothing is marked', () => {
    expect(parseShellVars('oh-my-zsh update prompt\n')).toEqual({});
  });
});
