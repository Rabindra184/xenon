import { describe, expect, it } from 'vitest';
import {
  XENON_APPIUM_MIN,
  appiumSatisfiesXenon,
  assessIphoneSupport,
  deriveAndroidHome,
  nodeSatisfiesAppium,
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

describe('nodeSatisfiesAppium', () => {
  // Appium 3.x engines: "^20.19.0 || ^22.12.0 || >=24.0.0".
  it('accepts the in-range even-LTS lines', () => {
    expect(nodeSatisfiesAppium('v20.19.0')).toBe(true);
    expect(nodeSatisfiesAppium('v20.20.2')).toBe(true);
    expect(nodeSatisfiesAppium('v22.12.0')).toBe(true);
    expect(nodeSatisfiesAppium('v22.19.0')).toBe(true);
    expect(nodeSatisfiesAppium('v24.0.0')).toBe(true);
    expect(nodeSatisfiesAppium('v24.11.1')).toBe(true);
    expect(nodeSatisfiesAppium('v26.5.0')).toBe(true);
  });

  it('rejects odd-numbered (non-LTS) majors that the old major>=18 check let through', () => {
    expect(nodeSatisfiesAppium('v21.7.3')).toBe(false);
    expect(nodeSatisfiesAppium('v23.6.0')).toBe(false); // the version that crashed the hub this session
  });

  it('rejects too-old majors and sub-minimum patch lines within an LTS major', () => {
    expect(nodeSatisfiesAppium('v18.17.1')).toBe(false); // below the floor, but major>=18 called it ok
    expect(nodeSatisfiesAppium('v20.18.9')).toBe(false); // 20.x but < 20.19
    expect(nodeSatisfiesAppium('v22.11.0')).toBe(false); // 22.x but < 22.12
  });

  it('tolerates a bare version string without the leading v', () => {
    expect(nodeSatisfiesAppium('24.11.1')).toBe(true);
    expect(nodeSatisfiesAppium('23.6.0')).toBe(false);
  });

  it('returns false for unparseable output', () => {
    expect(nodeSatisfiesAppium('not-a-version')).toBe(false);
    expect(nodeSatisfiesAppium('')).toBe(false);
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

describe('assessIphoneSupport', () => {
  const base = { platform: 'ios', binaryExists: true, installedVersion: 'v1.2.1', pinnedVersion: 'v1.2.1' };

  it('is not needed for Android-only profiles', () => {
    expect(assessIphoneSupport({ ...base, platform: 'android', binaryExists: false })).toEqual({
      status: 'ok',
      detail: 'Not needed for Android-only profiles.'
    });
  });

  it('warns that setup is needed when go-ios is not installed', () => {
    expect(assessIphoneSupport({ ...base, binaryExists: false, installedVersion: null })).toEqual({
      status: 'warn',
      detail: 'Not installed yet',
      remediation: "iPhones won't work until setup finishes. Run Set up again."
    });
  });

  it('warns when the installed go-ios is not the version Xenon pins', () => {
    expect(assessIphoneSupport({ ...base, installedVersion: 'v1.0.134' })).toEqual({
      status: 'warn',
      detail: 'go-ios v1.0.134, Xenon expects v1.2.1',
      remediation: 'Xenon was updated. Run Set up again to update iPhone support.'
    });
  });

  it('is ready when the installed go-ios matches the pin', () => {
    expect(assessIphoneSupport(base)).toEqual({ status: 'ok', detail: 'Ready for iPhones (go-ios v1.2.1)' });
  });

  it('is ready when Xenon pins no version', () => {
    expect(assessIphoneSupport({ ...base, pinnedVersion: null })).toEqual({
      status: 'ok',
      detail: 'Ready for iPhones'
    });
  });

  it('treats a missing version file as outdated when a version is pinned', () => {
    expect(assessIphoneSupport({ ...base, installedVersion: null })).toEqual({
      status: 'warn',
      detail: 'go-ios (unknown version), Xenon expects v1.2.1',
      remediation: 'Xenon was updated. Run Set up again to update iPhone support.'
    });
  });

  it('checks iPhone support when the profile has no platform set', () => {
    expect(assessIphoneSupport({ ...base, platform: undefined, binaryExists: false, installedVersion: null }).status).toBe(
      'warn'
    );
  });
});

describe('appiumSatisfiesXenon', () => {
  it('names the floor', () => {
    expect(XENON_APPIUM_MIN).toBe('3.1.1');
  });

  it.each([
    ['3.1.0', false],
    ['3.1.1', true],
    ['3.2.0', true],
    ['4.0.0', true],
    ['2.19.0', false],
    ['v3.1.1', true],
    ['3.0.9', false],
    ['3.1', false],
    ['garbage', false],
    ['', false],
    // Strictly three numbers: a pre-release is not a release of the floor, on purpose, and a
    // missing part is not read as zero.
    ['3.2.0-beta.1', false],
    ['3.1.1-rc.1', false],
    ['4..', false],
    ['3.2.', false],
    ['3.1.1.1', false],
    // The output's trailing newline is not part of the version.
    ['3.1.1\n', true],
    ['  3.1.1  ', true],
    ['v3.1.1', true],
    ['4.0.0', true]
  ])('%j -> %s', (version, expected) => {
    expect(appiumSatisfiesXenon(version)).toBe(expected);
  });
});
