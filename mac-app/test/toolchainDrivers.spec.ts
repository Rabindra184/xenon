import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolchainInspector } from '../src/main/ToolchainInspector';
import type { Profile } from '../src/shared/types';

// paths.ts (pulled in by the inspector) asks Electron for folders at import time.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

// The seam is what the inspector hands to child_process: every command it runs,
// with the environment it runs in. Nothing real is executed.
const calls = vi.hoisted(() => [] as { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[]);

vi.mock('node:child_process', async (importOriginal) => {
  const { promisify: p } = await import('node:util');
  const real = await importOriginal<typeof import('node:child_process')>();
  const execFile = Object.assign(vi.fn(), {
    [p.custom]: async (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
      calls.push({ cmd, args, env: opts.env });
      if (args[0] === 'driver') return { stdout: '- uiautomator2@6.0.0 [installed]\n- xcuitest@9.0.0 [installed]\n', stderr: '' };
      return { stdout: 'v22.12.0\n', stderr: '' };
    }
  });
  return { ...real, execFile };
});

// buildEnv layers `extra` on top of the process env, as the real one does.
vi.mock('../src/main/env', () => ({
  buildEnv: async (extra: Record<string, string> = {}) => ({ PATH: '/bin', ...extra }),
  resolveAndroidHome: async () => null,
  which: async (cmd: string) => `/bin/${cmd}`
}));

const profile = { id: 'a', server: { port: 4723 }, settings: {} } as unknown as Profile;

const driverCall = () => calls.find((c) => c.args[0] === 'driver');

beforeEach(() => {
  calls.length = 0;
});

describe('the Appium drivers check', () => {
  it('lists drivers from the profile Appium folder, the one Set up installs into and Start launches from', async () => {
    const checks = await new ToolchainInspector().checkAll(profile, '/profile/appium-home');
    const call = driverCall();
    expect(call?.args).toEqual(['driver', 'list', '--installed']);
    expect(call?.env.APPIUM_HOME).toBe('/profile/appium-home');
    const drivers = checks.find((c) => c.id === 'drivers');
    expect(drivers?.status).toBe('ok');
    expect(drivers?.detail).toBe('installed: uiautomator2, xcuitest');
  });

  it('leaves the folder to Appium when no profile folder is known', async () => {
    await new ToolchainInspector().checkAll();
    expect(driverCall()?.env).not.toHaveProperty('APPIUM_HOME');
  });

  it('does not hand the folder to the commands that do not need it', async () => {
    await new ToolchainInspector().checkAll(profile, '/profile/appium-home');
    const others = calls.filter((c) => c.args[0] !== 'driver');
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) expect(c.env).not.toHaveProperty('APPIUM_HOME');
  });
});
