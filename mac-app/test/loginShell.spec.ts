import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// R80: a slow login shell must never strand a tester. env.ts asks the login shell for PATH and the
// Android SDK (a Finder launch inherits neither). A read that fails (it took too long) is not kept:
// the next look at this Mac reads the shell again. A good read is kept for the looks nobody asked
// for (window focus, a changed port), and Check again, Try again and Start's own look read it again.
// Nothing real runs: the shell's answers below are what `zsh -ilc` prints, in order.

const shell = vi.hoisted(() => ({
  /** Each read the app made, with the timeout it gave the shell. */
  reads: [] as Array<{ timeout?: number }>,
  /** What each read answers, in order: printed text, or 'fail' for a read that timed out. */
  answers: [] as Array<string | 'fail' | (() => Promise<string>)>
}));

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

type Env = typeof import('../src/main/env');
let env: Env;

beforeEach(async () => {
  shell.reads = [];
  shell.answers = [];
  // A Finder launch: no PATH beyond the system's, and no SDK exported.
  vi.stubEnv('PATH', '/usr/bin:/bin');
  vi.stubEnv('ANDROID_HOME', '');
  vi.stubEnv('ANDROID_SDK_ROOT', '');
  vi.stubEnv('SHELL', '/bin/zsh');
  vi.resetModules();
  env = await import('../src/main/env');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the login shell read (R80)', () => {
  it('gives the login shell 15 seconds', async () => {
    shell.answers = [FIRST];
    await env.resolvePath();
    expect(shell.reads).toEqual([{ timeout: 15_000 }]);
  });

  it('gives up on a shell that has not answered in 15 seconds, even one whose children keep its output open', async () => {
    // execFile's own timeout kills the shell, but its answer waits for the output to close, which a
    // program the ~/.zshrc started can hold open for as long as it runs.
    vi.useFakeTimers();
    try {
      shell.answers = [() => new Promise<string>(() => {}), FIRST];
      const first = env.resolvePath();
      await vi.advanceTimersByTimeAsync(16_000);
      expect((await first).split(':')).not.toContain('/shell-one/bin');
      env.beginLook({ fresh: false });
      expect((await env.resolvePath()).split(':')[0]).toBe('/shell-one/bin');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keep a read that failed: the next look reads the shell again, and PATH and the Android SDK come from it', async () => {
    shell.answers = ['fail', FIRST];
    expect((await env.resolvePath()).split(':')).not.toContain('/shell-one/bin');
    expect(await env.resolveAndroidHome()).not.toBe('/shell-one/sdk');

    env.beginLook({ fresh: false }); // window focus, say: nobody asked, but the last read failed
    expect((await env.resolvePath()).split(':')[0]).toBe('/shell-one/bin');
    expect(await env.resolveAndroidHome()).toBe('/shell-one/sdk');
    expect(shell.reads).toHaveLength(2);
  });

  it('reads a failing shell once for a whole look, not once for each tool it looks for', async () => {
    shell.answers = ['fail'];
    // The checks run side by side, and each asks for PATH more than once.
    await Promise.all([env.which('node'), env.resolvePath(), env.resolveAndroidHome(), env.buildEnv(), env.shellAppiumHome()]);
    await env.which('appium');
    await env.buildEnv({ APPIUM_HOME: '/x' });
    expect(shell.reads).toHaveLength(1);
  });

  it('keeps a good read for the looks nobody asked for (window focus, a changed port)', async () => {
    shell.answers = [FIRST];
    await env.resolvePath();
    env.beginLook({ fresh: false });
    env.beginLook({ fresh: false });
    expect((await env.resolvePath()).split(':')[0]).toBe('/shell-one/bin');
    expect(await env.resolveAndroidHome()).toBe('/shell-one/sdk');
    expect(shell.reads).toHaveLength(1);
  });

  it('reads the shell again on Check again, Try again and Start’s own look, and PATH and the Android SDK with it', async () => {
    shell.answers = [FIRST, SECOND];
    expect((await env.resolvePath()).split(':')[0]).toBe('/shell-one/bin');
    expect(await env.resolveAndroidHome()).toBe('/shell-one/sdk');

    env.beginLook({ fresh: true });
    const path = (await env.resolvePath()).split(':');
    expect(path[0]).toBe('/shell-two/bin');
    expect(path).not.toContain('/shell-one/bin');
    expect(await env.resolveAndroidHome()).toBe('/shell-two/sdk');
    expect((await env.buildEnv()).ANDROID_HOME).toBe('/shell-two/sdk');
    expect(shell.reads).toHaveLength(2);
  });

  it('does not keep the answer of a read that was still running when Check again asked for a new one', async () => {
    let finishFirst!: (text: string) => void;
    shell.answers = [() => new Promise<string>((r) => (finishFirst = r)), SECOND];
    const slow = env.resolvePath();
    await vi.waitFor(() => expect(shell.reads).toHaveLength(1));

    env.beginLook({ fresh: true });
    expect((await env.resolvePath()).split(':')[0]).toBe('/shell-two/bin');

    finishFirst(FIRST);
    expect((await slow).split(':')[0]).toBe('/shell-one/bin'); // what it read, for the one who asked
    expect((await env.resolvePath()).split(':')[0]).toBe('/shell-two/bin'); // but not kept
    expect(await env.resolveAndroidHome()).toBe('/shell-two/sdk');
    expect(shell.reads).toHaveLength(2);
  });
});
