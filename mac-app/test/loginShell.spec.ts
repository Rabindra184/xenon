import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginMarkerPath } from '../src/main/toolchainRules';
import type { Profile } from '../src/shared/types';

// R80, as R82 refines it: a slow login shell must never strand a tester, nor slow every look.
// env.ts asks the login shell for PATH, the Android SDK and APPIUM_HOME (a Finder launch inherits
// none). A good read is kept, and every look reuses it (launch, window focus, Start's own check);
// only Check again and Try again forget it and read again. A read that failed is never kept: Check
// again and Try again retry it at once, any other look at most once a minute. The read before the
// first window has 5 seconds, as before 0.3.0; a later one 15. After a later read that answers, the
// automatic Appium folder is picked again. Nothing real runs: the shell's answers are below, in order.

const shell = vi.hoisted(() => ({
  /** Each read the app made, with the timeout it gave the shell. */
  reads: [] as Array<{ timeout?: number }>,
  /** What each read answers, in order: printed text, or 'fail' for a read that timed out. */
  answers: [] as Array<string | 'fail' | (() => Promise<string>)>,
  /** Electron's userData folder, for the app's own Appium folder. */
  userData: '',
  /** The home folder the app sees: the test's own, so ~/.appium is never the real one. */
  home: ''
}));

vi.mock('electron', () => ({ app: { getPath: () => shell.userData } }));

// os.homedir() reads the process's own environment, which a stubbed HOME doesn't reach from a test
// worker, so it is stood in for: ~ is the test's folder, never the developer's.
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>();
  const homedir = () => shell.home;
  return { ...real, homedir, default: { ...real.default, homedir } };
});

vi.mock('node:child_process', async (importOriginal) => {
  const { promisify: p } = await import('node:util');
  const real = await importOriginal<typeof import('node:child_process')>();
  const execFile = Object.assign(vi.fn(), {
    [p.custom]: async (_cmd: string, _args: string[], opts: { timeout?: number } = {}) => {
      shell.reads.push({ timeout: opts.timeout });
      const answer = shell.answers.shift();
      if (answer === undefined) throw new Error('the test gave the shell no answer for this read');
      if (answer === 'fail') throw Object.assign(new Error('Command failed: /bin/zsh -ilc'), { killed: true, signal: 'SIGTERM' });
      return { stdout: typeof answer === 'function' ? await answer() : answer, stderr: '' };
    }
  });
  return { ...real, execFile };
});

const printed = (vars: Record<string, string>): string =>
  Object.entries(vars)
    .map(([k, v]) => `__XENON_${k}__:${v}`)
    .join('\n') + '\n';

const FIRST = printed({ PATH: '/shell-one/bin:/usr/bin', ANDROID_HOME: '/shell-one/sdk' });
const SECOND = printed({ PATH: '/shell-two/bin:/usr/bin', ANDROID_HOME: '/shell-two/sdk' });
const firstOnPath = async (): Promise<string> => (await env.resolvePath()).split(':')[0];

type Env = typeof import('../src/main/env');
type Home = typeof import('../src/main/appiumHome');
let env: Env;
let home: Home;
let tmp: string;

beforeEach(async () => {
  shell.reads = [];
  shell.answers = [];
  tmp = mkdtempSync(path.join(os.tmpdir(), 'xc-login-shell-'));
  shell.userData = path.join(tmp, 'userData');
  shell.home = path.join(tmp, 'home');
  mkdirSync(shell.home);
  // A Finder launch: no PATH beyond the system's, no SDK or APPIUM_HOME exported, and a home of the
  // test's own, so ~/.appium is never the real one.
  vi.stubEnv('HOME', path.join(tmp, 'home'));
  vi.stubEnv('PATH', '/usr/bin:/bin');
  vi.stubEnv('ANDROID_HOME', '');
  vi.stubEnv('ANDROID_SDK_ROOT', '');
  vi.stubEnv('APPIUM_HOME', '');
  vi.stubEnv('SHELL', '/bin/zsh');
  vi.resetModules();
  env = await import('../src/main/env');
  home = await import('../src/main/appiumHome');
  // The guard: the app's ~ here is the test's folder.
  expect((await import('node:os')).default.homedir()).toBe(shell.home);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe('how long a read may take (R82)', () => {
  it('gives the read before the first window 5 seconds, as before 0.3.0, and a later read 15', async () => {
    shell.answers = ['fail', FIRST];
    await env.readLoginShellAtLaunch();
    await env.beginLook({ fresh: true });
    expect(shell.reads).toEqual([{ timeout: 5_000 }, { timeout: 15_000 }]);
  });

  it('gives up on a shell that has not answered in time, even one whose children keep its output open', async () => {
    // execFile's own timeout kills the shell, but its answer waits for the output to close, which a
    // program the ~/.zshrc started can hold open for as long as it runs.
    vi.useFakeTimers();
    shell.answers = [() => new Promise<string>(() => {}), () => new Promise<string>(() => {}), FIRST];
    const atLaunch = env.readLoginShellAtLaunch();
    await vi.advanceTimersByTimeAsync(5_600);
    await atLaunch;
    expect((await env.resolvePath()).split(':')).not.toContain('/shell-one/bin');

    const later = env.beginLook({ fresh: true });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(shell.reads).toHaveLength(2); // still waiting at 14 s
    await vi.advanceTimersByTimeAsync(1_600);
    expect(await later).toEqual({ readAnew: false });

    expect(await env.beginLook({ fresh: true })).toEqual({ readAnew: true });
    expect(await firstOnPath()).toBe('/shell-one/bin');
  });
});

describe('a good read (R82)', () => {
  it('is reused by every look but Check again and Try again: launch, window focus and Start read nothing', async () => {
    shell.answers = [FIRST];
    await env.readLoginShellAtLaunch();
    for (let i = 0; i < 3; i++) expect(await env.beginLook({ fresh: false })).toEqual({ readAnew: false });
    expect(await firstOnPath()).toBe('/shell-one/bin');
    expect(await env.resolveAndroidHome()).toBe('/shell-one/sdk');
    expect(shell.reads).toHaveLength(1);
  });

  it('is read again on Check again and Try again, and PATH and the Android SDK with it', async () => {
    shell.answers = [FIRST, SECOND];
    await env.readLoginShellAtLaunch();
    expect(await firstOnPath()).toBe('/shell-one/bin');

    expect(await env.beginLook({ fresh: true })).toEqual({ readAnew: true });
    const found = (await env.resolvePath()).split(':');
    expect(found[0]).toBe('/shell-two/bin');
    expect(found).not.toContain('/shell-one/bin');
    expect(await env.resolveAndroidHome()).toBe('/shell-two/sdk');
    expect((await env.buildEnv()).ANDROID_HOME).toBe('/shell-two/sdk');
    expect(shell.reads).toHaveLength(2);
  });

  it('is not kept from a read still running when Check again asked for a new one', async () => {
    let finishFirst!: (text: string) => void;
    shell.answers = [() => new Promise<string>((r) => (finishFirst = r)), SECOND];
    const slow = env.resolvePath();
    await vi.waitFor(() => expect(shell.reads).toHaveLength(1));

    await env.beginLook({ fresh: true });
    expect(await firstOnPath()).toBe('/shell-two/bin');

    finishFirst(FIRST);
    expect((await slow).split(':')[0]).toBe('/shell-one/bin'); // what it read, for the one who asked
    expect(await firstOnPath()).toBe('/shell-two/bin'); // but not kept
    expect(await env.resolveAndroidHome()).toBe('/shell-two/sdk');
    expect(shell.reads).toHaveLength(2);
  });
});

describe('a failed read (R82)', () => {
  it('is never kept, and a look nobody asked for (launch, focus, Start) tries it again at most once a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-08T09:00:00Z').getTime();
    vi.setSystemTime(t0);
    shell.answers = ['fail', 'fail', FIRST];
    await env.readLoginShellAtLaunch(); // the read before the window comes too late

    for (const after of [0, 10_000, 59_900]) {
      vi.setSystemTime(t0 + after);
      expect(await env.beginLook({ fresh: false })).toEqual({ readAnew: false });
    }
    expect(shell.reads).toHaveLength(1);
    expect((await env.resolvePath()).split(':')).not.toContain('/shell-one/bin'); // the well-known folders meanwhile

    vi.setSystemTime(t0 + 60_000); // a minute on: tried again, and it fails again
    expect(await env.beginLook({ fresh: false })).toEqual({ readAnew: false });
    expect(shell.reads).toHaveLength(2);

    vi.setSystemTime(t0 + 100_000); // under a minute since that one
    await env.beginLook({ fresh: false });
    expect(shell.reads).toHaveLength(2);

    vi.setSystemTime(t0 + 120_000);
    expect(await env.beginLook({ fresh: false })).toEqual({ readAnew: true });
    expect(await firstOnPath()).toBe('/shell-one/bin');
    expect(await env.resolveAndroidHome()).toBe('/shell-one/sdk');
    expect(shell.reads).toHaveLength(3);
  });

  it('is tried again at once on Check again and Try again', async () => {
    shell.answers = ['fail', 'fail', FIRST];
    await env.readLoginShellAtLaunch();
    expect(await env.beginLook({ fresh: true })).toEqual({ readAnew: false });
    expect(await env.beginLook({ fresh: true })).toEqual({ readAnew: true });
    expect(await firstOnPath()).toBe('/shell-one/bin');
    expect(shell.reads).toHaveLength(3);
  });

  it('is read once for a whole look, not once for each tool the look looks for', async () => {
    shell.answers = ['fail'];
    // The checks run side by side, and each asks for PATH more than once.
    await Promise.all([
      env.beginLook({ fresh: true }),
      env.which('node'),
      env.resolvePath(),
      env.resolveAndroidHome(),
      env.buildEnv(),
      env.shellAppiumHome()
    ]);
    await env.which('appium');
    await env.buildEnv({ APPIUM_HOME: '/x' });
    expect(shell.reads).toHaveLength(1);
  });
});

describe('the automatic Appium folder (R82)', () => {
  const auto = { id: 'a', server: { appiumHome: '' } } as unknown as Profile;
  const withXenon = (dir: string) => {
    mkdirSync(path.dirname(pluginMarkerPath(dir)), { recursive: true });
    writeFileSync(pluginMarkerPath(dir), '{}');
  };

  it('is picked again after a later read answers, so an APPIUM_HOME the read at launch missed is found', async () => {
    const named = path.join(tmp, 'lab-appium');
    withXenon(named);
    shell.answers = ['fail', printed({ PATH: '/shell-one/bin:/usr/bin', APPIUM_HOME: named })];
    await env.readLoginShellAtLaunch();
    await home.warmAppiumHome();
    expect(home.resolvedAppiumHomeInfo(auto).source).not.toBe('env');

    await home.beginPreflightLook({ fresh: true }); // Try again
    expect(home.resolvedAppiumHomeInfo(auto)).toEqual({ path: named, source: 'env' });
    expect(home.resolveAppiumHome(auto)).toBe(named);
  });

  it('is not picked again by a look that reuses the kept read', async () => {
    shell.answers = [printed({ PATH: '/shell-one/bin:/usr/bin' })];
    await env.readLoginShellAtLaunch();
    await home.warmAppiumHome();
    expect(home.resolvedAppiumHomeInfo(auto).source).toBe('fallback');

    withXenon(path.join(tmp, 'home', '.appium')); // Xenon appears in ~/.appium meanwhile
    await home.beginPreflightLook({ fresh: false }); // window focus: no read, so nothing is picked
    expect(home.resolvedAppiumHomeInfo(auto).source).toBe('fallback');

    shell.answers = [printed({ PATH: '/shell-one/bin:/usr/bin' })];
    await home.beginPreflightLook({ fresh: true }); // Check again
    expect(home.resolvedAppiumHomeInfo(auto)).toEqual({ path: path.join(tmp, 'home', '.appium'), source: 'convention' });
  });
});
