import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolchainInspector } from '../src/main/ToolchainInspector';
import { NPM_PLUGIN } from '../src/main/setupPlan';
import type { CheckCode, Profile, ToolCheck } from '../src/shared/types';

// Every check the inspector returns says what happened in a `code`, so Setup
// can write a plain sentence without reading the raw words. Nothing real runs:
// the world below is what `which`, the commands and the disk answer.

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

const world = vi.hoisted(() => ({
  /** Commands `which` finds. */
  binaries: new Set<string>(),
  /** Files that exist, with their text. */
  files: new Map<string, string>(),
  /** What a command prints, by `<command> <first argument>`; an Error makes it fail. */
  prints: new Map<string, string | Error>(),
  androidHome: null as string | null
}));

vi.mock('node:child_process', async (importOriginal) => {
  const { promisify: p } = await import('node:util');
  const real = await importOriginal<typeof import('node:child_process')>();
  const execFile = Object.assign(vi.fn(), {
    [p.custom]: async (cmd: string, args: string[]) => {
      const printed = world.prints.get(`${cmd.split('/').pop()} ${args[0]}`);
      if (printed instanceof Error) throw printed;
      return { stdout: printed ?? '', stderr: '' };
    }
  });
  return { ...real, execFile };
});

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const existsSync = (p: string) => world.files.has(p);
  const readFileSync = (p: string) => {
    const text = world.files.get(p);
    if (text === undefined) throw new Error('ENOENT');
    return text;
  };
  return { ...real, existsSync, readFileSync, default: { ...real, existsSync, readFileSync } };
});

vi.mock('../src/main/env', () => ({
  buildEnv: async (extra: Record<string, string> = {}) => ({ PATH: '/bin', ...extra }),
  resolveAndroidHome: async () => world.androidHome,
  which: async (cmd: string) => (world.binaries.has(cmd) ? `/bin/${cmd}` : null)
}));

const GO_IOS_DIR = path.join(os.homedir(), '.cache', 'xenon', 'goIOS');
const APPIUM_HOME = '/profile/appium-home';
const PIN_FILE = path.join(APPIUM_HOME, 'node_modules', NPM_PLUGIN, 'lib', 'src', 'scripts', 'goIosVersion.js');

const profile = (platform: string): Profile => ({ id: 'a', server: { port: 4723 }, settings: { platform } }) as unknown as Profile;

/** A Mac where everything is fine; each test spoils the one thing it is about. */
function goodMac(): void {
  world.binaries = new Set(['node', 'appium', 'adb', 'xcodebuild']);
  world.files = new Map([
    ['/bin/adb', ''],
    [path.join(GO_IOS_DIR, 'ios'), ''],
    [path.join(GO_IOS_DIR, '.go-ios-version'), 'v1.2.1'],
    [PIN_FILE, "exports.GO_IOS_VERSION = 'v1.2.1';"]
  ]);
  world.prints = new Map<string, string | Error>([
    ['node -v', 'v22.12.0\n'],
    ['appium -v', '3.1.1\n'],
    ['appium driver', '- uiautomator2@6.0.0 [installed]\n- xcuitest@9.0.0 [installed]\n'],
    ['adb version', 'Android Debug Bridge version 1.0.41\n'],
    ['xcodebuild -version', 'Xcode 16.0\nBuild version 16A242d\n']
  ]);
  world.androidHome = '/sdk';
}

async function check(id: string, platform = 'both'): Promise<ToolCheck> {
  const checks = await new ToolchainInspector().checkAll(profile(platform), APPIUM_HOME);
  const found = checks.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no ${id} check`);
  return found;
}

beforeEach(goodMac);

describe('every check says what happened in a code', () => {
  it('gives a code to all six checks on a Mac where everything is fine', async () => {
    const checks = await new ToolchainInspector().checkAll(profile('both'), APPIUM_HOME);
    expect(checks.map((c) => [c.id, c.code])).toEqual([
      ['node', 'ok'],
      ['appium', 'ok'],
      ['drivers', 'ok'],
      ['adb', 'ok'],
      ['xcode', 'ok'],
      ['go-ios', 'ok']
    ]);
  });

  it('gives a code to every check on a Mac where nothing is installed', async () => {
    world.binaries = new Set();
    world.files = new Map();
    world.androidHome = null;
    const checks = await new ToolchainInspector().checkAll(profile('both'));
    const known: CheckCode[] = ['ok', 'missing', 'unsupported', 'list-failed', 'no-sdk-root', 'not-needed', 'stale'];
    expect(checks).toHaveLength(6);
    for (const c of checks) expect(known).toContain(c.code);
    expect(checks.map((c) => [c.id, c.code])).toEqual([
      ['node', 'missing'],
      ['appium', 'missing'],
      ['drivers', 'missing'],
      ['adb', 'missing'],
      ['xcode', 'missing'],
      ['go-ios', 'missing']
    ]);
  });
});

describe('node', () => {
  it('is missing when not on the PATH', async () => {
    world.binaries.delete('node');
    expect(await check('node')).toMatchObject({ status: 'missing', code: 'missing' });
  });

  it.each(['v23.1.0', 'v20.18.0', 'v22.11.0', 'v18.19.0'])('is unsupported on %s', async (version) => {
    world.prints.set('node -v', `${version}\n`);
    expect(await check('node')).toMatchObject({ status: 'warn', code: 'unsupported' });
  });

  it.each(['v20.19.0', 'v22.12.0', 'v24.0.0'])('is ok on %s', async (version) => {
    world.prints.set('node -v', `${version}\n`);
    expect(await check('node')).toMatchObject({ status: 'ok', code: 'ok' });
  });

  // Row 54: Homebrew's node@22 is keg-only, so it installs a Node that is not on the PATH and the check
  // still finds none. The fix says the plain formula, whose Node is linked onto the PATH.
  it('says brew install node, never a keg-only node@ formula, when Node.js is missing or the wrong version', async () => {
    world.binaries.delete('node');
    const missing = (await check('node')).remediation ?? '';
    goodMac();
    world.prints.set('node -v', 'v23.1.0\n');
    const wrong = (await check('node')).remediation ?? '';
    for (const fix of [missing, wrong]) {
      expect(fix).toContain('brew install node)');
      expect(fix).not.toMatch(/node@/);
    }
  });
});

describe('appium', () => {
  it('is missing when not on the PATH', async () => {
    world.binaries.delete('appium');
    expect(await check('appium')).toMatchObject({ status: 'missing', code: 'missing' });
  });

  it('is unsupported when too old', async () => {
    world.prints.set('appium -v', '3.0.9\n');
    expect(await check('appium')).toMatchObject({ status: 'warn', code: 'unsupported' });
  });

  // A version command that fails or crashes is not a verdict on the version (R32).
  it('is missing, not too old, when it will not even print its version', async () => {
    world.prints.set('appium -v', new Error('Command failed: /bin/appium -v\nSyntaxError: Unexpected token \'?\'\n'));
    expect(await check('appium')).toMatchObject({
      status: 'warn',
      code: 'missing',
      detail: "SyntaxError: Unexpected token '?'",
      blocking: true,
      remediation: 'Install Appium 3: npm i -g appium'
    });
  });

  it('is missing, not too old, when what it printed is not a version', async () => {
    world.prints.set('appium -v', 'Error: Cannot find module \'@appium/support\'\n');
    expect(await check('appium')).toMatchObject({ status: 'warn', code: 'missing', blocking: true });
  });

  it.each(['3.0.9', 'v3.0.0', '3.2.0-beta.1'])('is still too old for a version it printed: %s', async (version) => {
    world.prints.set('appium -v', `${version}\n`);
    expect(await check('appium')).toMatchObject({ status: 'warn', code: 'unsupported', blocking: true });
  });

  it('is ok at the floor', async () => {
    expect(await check('appium')).toMatchObject({ status: 'ok', code: 'ok' });
  });
});

describe('drivers', () => {
  it('is missing when there is no Appium to ask, and its detail says so as before', async () => {
    world.binaries.delete('appium');
    expect(await check('drivers')).toMatchObject({
      status: 'missing',
      code: 'missing',
      detail: 'appium not available'
    });
  });

  it('is list-failed when the list could not be read, and its detail says so as before', async () => {
    world.prints.set('appium driver', new Error('boom'));
    expect(await check('drivers')).toMatchObject({
      status: 'warn',
      code: 'list-failed',
      detail: 'could not list drivers'
    });
  });

  it('is ok when the list was read, whichever drivers it holds, and the detail still lists them', async () => {
    expect(await check('drivers')).toMatchObject({ code: 'ok', detail: 'installed: uiautomator2, xcuitest' });
    world.prints.set('appium driver', '- xcuitest@9.0.0 [installed]\n');
    expect(await check('drivers')).toMatchObject({ code: 'ok', detail: 'installed: xcuitest' });
    world.prints.set('appium driver', '');
    expect(await check('drivers')).toMatchObject({ status: 'warn', code: 'ok', detail: 'installed: none' });
  });
});

describe('adb', () => {
  it('is missing, with what adb said, when it is there but will not print its version (R30)', async () => {
    world.prints.set('adb version', new Error('Command failed: /bin/adb version\ndyld: Library not loaded: libc++.1.dylib\n'));
    expect(await check('adb')).toMatchObject({
      status: 'warn',
      code: 'missing',
      detail: 'dyld: Library not loaded: libc++.1.dylib',
      blocking: false,
      remediation: expect.stringContaining('Install the Android SDK')
    });
  });

  it('is missing, not ok, when its version command fails with nothing more to say', async () => {
    world.prints.set('adb version', new Error('Command failed: /bin/adb version\n'));
    const adb = await check('adb');
    expect(adb).toMatchObject({ status: 'warn', code: 'missing' });
    expect(adb.detail).not.toMatch(/^Command failed/);
    expect(adb.detail).not.toBe('');
  });

  it('is missing when there is no adb and no SDK', async () => {
    world.binaries.delete('adb');
    world.files.delete('/bin/adb');
    world.androidHome = null;
    expect(await check('adb')).toMatchObject({ status: 'warn', code: 'missing' });
  });

  it('is no-sdk-root when adb works but no SDK root can be named', async () => {
    world.androidHome = null;
    expect(await check('adb')).toMatchObject({ status: 'warn', code: 'no-sdk-root' });
  });

  it('is ok with adb and an SDK root', async () => {
    expect(await check('adb')).toMatchObject({ status: 'ok', code: 'ok' });
  });
});

describe('xcode', () => {
  it('is missing without xcodebuild', async () => {
    world.binaries.delete('xcodebuild');
    expect(await check('xcode')).toMatchObject({ status: 'warn', code: 'missing' });
  });

  it('is ok with it', async () => {
    expect(await check('xcode')).toMatchObject({ status: 'ok', code: 'ok' });
  });

  // /usr/bin/xcodebuild is a macOS shim that is always on the PATH; with only the Command Line Tools
  // it fails. That is not ready (R30).
  it('is missing, with what xcodebuild said, when the shim is there but Xcode is not (R30)', async () => {
    world.prints.set(
      'xcodebuild -version',
      new Error(
        'Command failed: /usr/bin/xcodebuild -version\n' +
          "xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory " +
          "'/Library/Developer/CommandLineTools' is a command line tools instance\n"
      )
    );
    expect(await check('xcode')).toMatchObject({
      status: 'warn',
      code: 'missing',
      detail:
        "xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory " +
        "'/Library/Developer/CommandLineTools' is a command line tools instance",
      blocking: false,
      remediation: 'Only needed for iOS. Install Xcode and run xcode-select --install.'
    });
  });

  it('is missing, not ok, when its version command fails with nothing more to say', async () => {
    world.prints.set('xcodebuild -version', new Error('Command failed: /bin/xcodebuild -version'));
    const xcode = await check('xcode');
    expect(xcode).toMatchObject({ status: 'warn', code: 'missing' });
    expect(xcode.detail).not.toMatch(/^Command failed/);
    expect(xcode.detail).not.toBe('');
  });
});

describe('go-ios', () => {
  it('is not-needed for an Android-only profile', async () => {
    expect(await check('go-ios', 'android')).toMatchObject({ status: 'ok', code: 'not-needed' });
  });

  it('is missing when go-ios is not installed', async () => {
    world.files.delete(path.join(GO_IOS_DIR, 'ios'));
    expect(await check('go-ios')).toMatchObject({ status: 'warn', code: 'missing' });
  });

  it('is stale when go-ios is not the version the plugin pins', async () => {
    world.files.set(path.join(GO_IOS_DIR, '.go-ios-version'), 'v1.0.134');
    expect(await check('go-ios')).toMatchObject({ status: 'warn', code: 'stale' });
  });

  it('is ok when it matches the pin', async () => {
    expect(await check('go-ios')).toMatchObject({ status: 'ok', code: 'ok' });
  });
});
