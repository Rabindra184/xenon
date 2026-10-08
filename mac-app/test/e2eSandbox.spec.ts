import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_MARKER } from '../src/main/toolchainRules';
import {
  SANDBOX_SKIP,
  SANDBOX_VAR,
  assertNoRealAppiumHome,
  inheritedEnv,
  isUnderRealAppiumHome,
  launchConfigHits,
  makeThrowawayHome,
  realUserHome,
  shellQuote,
  xenonPackageJson,
  xenonSandbox
} from './e2e/sandbox';

// The e2e harness's guard (test/e2e/sandbox.ts): a run must never use the developer's real
// ~/.appium. Here the "real home" is a stand-in folder made for each test, so the guard is seen to
// fire without the real ~/.appium being involved at all.

const made: string[] = [];
const folder = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

/** A stand-in for the real user's home, with a ~/.appium holding Xenon, as the developer's does. */
function standInHome(): { home: string; appium: string } {
  const home = folder('xenon-guard-realhome-');
  const appium = path.join(home, '.appium');
  mkdirSync(path.dirname(xenonPackageJson(appium)), { recursive: true });
  writeFileSync(xenonPackageJson(appium), JSON.stringify({ name: '@xenon-device-management/xenon', version: '2.17.0' }));
  return { home, appium };
}

/** A sandbox Appium folder with Xenon in it. */
function sandbox(version = '2.9.2'): string {
  const dir = folder('xenon-guard-sandbox-');
  mkdirSync(path.dirname(xenonPackageJson(dir)), { recursive: true });
  writeFileSync(xenonPackageJson(dir), JSON.stringify({ name: '@xenon-device-management/xenon', version }));
  return dir;
}

describe('the e2e guard against the real ~/.appium', () => {
  it('takes the real home from the account, not from $HOME, which a run changes', () => {
    const before = process.env.HOME;
    process.env.HOME = '/tmp/not-the-real-home';
    try {
      expect(realUserHome()).toBe(os.userInfo().homedir);
      expect(realUserHome()).not.toBe('/tmp/not-the-real-home');
    } finally {
      process.env.HOME = before;
    }
  });

  it('fires for ~/.appium and anything inside it, whatever the case, and for nothing beside it', () => {
    const { home, appium } = standInHome();
    expect(isUnderRealAppiumHome(appium, home)).toBe(true);
    expect(isUnderRealAppiumHome(appium + '/', home)).toBe(true);
    expect(isUnderRealAppiumHome(path.join(appium, 'node_modules', '@xenon-device-management'), home)).toBe(true);
    expect(isUnderRealAppiumHome(path.join(home, '.APPIUM'), home)).toBe(true);
    expect(isUnderRealAppiumHome(path.join(home, 'x', '..', '.appium'), home)).toBe(true);
    expect(isUnderRealAppiumHome(path.join('/System/Volumes/Data', appium), home)).toBe(true);

    expect(isUnderRealAppiumHome(home, home)).toBe(false);
    expect(isUnderRealAppiumHome(path.join(home, '.appium-old'), home)).toBe(false);
    expect(isUnderRealAppiumHome(path.join(home, 'work', '.appium'), home)).toBe(false);
    expect(isUnderRealAppiumHome(sandbox(), home)).toBe(false);
  });

  it('follows a symbolic link into ~/.appium, and stops at ~/.appium without looking inside', () => {
    const { home, appium } = standInHome();
    const links = folder('xenon-guard-links-');
    symlinkSync(appium, path.join(links, 'to-appium'));
    symlinkSync('to-appium', path.join(links, 'relative'));
    symlinkSync(home, path.join(links, 'to-home'));
    expect(isUnderRealAppiumHome(path.join(links, 'to-appium'), home)).toBe(true);
    expect(isUnderRealAppiumHome(path.join(links, 'relative', 'node_modules'), home)).toBe(true);
    expect(isUnderRealAppiumHome(path.join(links, 'to-home', '.appium'), home)).toBe(true);

    // ~/.appium is judged by its name: were it a link to somewhere harmless, it is still refused,
    // because the walk never opens it to see where it leads.
    const elsewhere = sandbox();
    rmSync(appium, { recursive: true, force: true });
    symlinkSync(elsewhere, appium);
    expect(isUnderRealAppiumHome(path.join(appium, 'node_modules'), home)).toBe(true);
    expect(isUnderRealAppiumHome(elsewhere, home)).toBe(false);
  });

  it('fails loudly, naming each folder, when the app resolved ~/.appium', () => {
    const { home, appium } = standInHome();
    const ok = sandbox();
    expect(() => assertNoRealAppiumHome([{ what: 'a profile on auto', path: ok }], null, home)).not.toThrow();
    expect(() =>
      assertNoRealAppiumHome(
        [
          { what: 'a profile on auto', path: appium },
          { what: 'profile “QA”', path: ok }
        ],
        null,
        home
      )
    ).toThrow(/^E2E GUARD: [\s\S]*a profile on auto: .*\.appium$/m);
  });

  it('fails loudly when a launch config names ~/.appium, in full or with ~', () => {
    const { home, appium } = standInHome();
    const userData = folder('xenon-guard-userdata-');
    const configs = path.join(userData, 'launch-configs');
    mkdirSync(configs);
    writeFileSync(path.join(configs, 'fine.yaml'), `server:\n  port: 4799\n`);
    expect(launchConfigHits(userData, home)).toEqual([]);
    expect(() => assertNoRealAppiumHome([], userData, home)).not.toThrow();

    writeFileSync(path.join(configs, 'full.yaml'), `server:\n  plugin:\n    xenon:\n      appiumHome: ${appium}\n`);
    writeFileSync(path.join(configs, 'tilde.yaml'), `env:\n  APPIUM_HOME: "~/.appium"\n`);
    expect(launchConfigHits(userData, home).map((h) => h.what).sort()).toEqual([
      'launch config full.yaml',
      'launch config tilde.yaml'
    ]);
    expect(() => assertNoRealAppiumHome([], userData, home)).toThrow(/E2E GUARD/);
  });

  it('refuses a sandbox named under ~/.appium before looking inside it, and skips without one', () => {
    const { home, appium } = standInHome();
    expect(() => xenonSandbox({ [SANDBOX_VAR]: appium }, home)).toThrow(/E2E GUARD/);
    expect(() => xenonSandbox({ [SANDBOX_VAR]: path.join(appium, 'nested') }, home)).toThrow(/E2E GUARD/);

    expect(xenonSandbox({}, home)).toBeNull();
    expect(xenonSandbox({ [SANDBOX_VAR]: '  ' }, home)).toBeNull();
    expect(xenonSandbox({ [SANDBOX_VAR]: folder('xenon-guard-empty-') }, home)).toBeNull();
    const ready = sandbox();
    expect(xenonSandbox({ [SANDBOX_VAR]: ready }, home)).toBe(ready);
    expect(SANDBOX_SKIP).toBe(
      'Set XENON_E2E_APPIUM_HOME to a folder with Xenon installed (APPIUM_HOME=<dir> appium plugin install …) to run the tests that start a server.'
    );
  });

  it('looks for Xenon where the app does', () => {
    expect(path.dirname(xenonPackageJson('/h'))).toBe(path.join('/h', ...PLUGIN_MARKER));
  });
});

describe('the throwaway HOME the app is launched with', () => {
  /** What a login shell started on `home` exports, as the app reads it (src/main/env.ts). */
  const exported = (shell: string, home: string, name: string) =>
    execFileSync(shell, ['-c', `. "$HOME/${shell.endsWith('zsh') ? '.zshrc' : '.bash_profile'}"; printf %s "$${name}"`], {
      env: { HOME: home, PATH: '/usr/bin:/bin' },
      encoding: 'utf8'
    });

  it('exports this process’s PATH and Android SDK exactly, quoted, and APPIUM_HOME only for a sandbox', () => {
    const odd = `/opt/a b/bin:/opt/it's/bin:/opt/$HOME/bin:/opt/\`x\`/bin`;
    const home = makeThrowawayHome({ env: { PATH: odd, ANDROID_HOME: '/sdk dir' }, appiumHome: null });
    made.push(home);
    for (const file of ['.zshrc', '.bashrc', '.bash_profile']) expect(readFileSync(path.join(home, file), 'utf8')).toContain('export PATH=');
    expect(exported('/bin/bash', home, 'PATH')).toBe(odd);
    expect(exported('/bin/zsh', home, 'PATH')).toBe(odd);
    expect(exported('/bin/bash', home, 'ANDROID_HOME')).toBe('/sdk dir');
    expect(exported('/bin/bash', home, 'ANDROID_SDK_ROOT')).toBe('');
    expect(exported('/bin/bash', home, 'APPIUM_HOME')).toBe('');

    const box = sandbox();
    const withSandbox = makeThrowawayHome({ env: { PATH: '/usr/bin' }, appiumHome: box });
    made.push(withSandbox);
    expect(exported('/bin/zsh', withSandbox, 'APPIUM_HOME')).toBe(box);
  });

  it('quotes for a POSIX shell', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });

  it('passes on nothing that points at the developer’s own folders', () => {
    const env = inheritedEnv({
      PATH: '/usr/bin',
      APPIUM_HOME: '/Users/someone/.appium',
      DATABASE_URL: 'file:/Users/someone/.cache/xenon/xenon.db',
      ZDOTDIR: '/Users/someone',
      BASH_ENV: '/Users/someone/.bashrc',
      ENV: '/Users/someone/.profile',
      [SANDBOX_VAR]: '/tmp/sandbox',
      LANG: 'en_GB.UTF-8'
    });
    expect(env).toEqual({ PATH: '/usr/bin', LANG: 'en_GB.UTF-8' });
  });
});
