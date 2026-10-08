import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRequests, type OpenDeps } from '../src/main/openRequests';
import type { Profile, ServerState } from '../src/shared/types';

// M8: the window asks main to open the dashboard and a folder, and main does not take its word for
// what to open. The dashboard is main's own running server's; a folder is a folder that is there.

const DASHBOARD = 'http://127.0.0.1:4797/xenon/';
let dir: string;
let deps: OpenDeps & { opened: string[]; external: string[]; state: Pick<ServerState, 'status' | 'dashboardUrl'>; home: string };

function makeDeps(): typeof deps {
  const d = {
    opened: [] as string[],
    external: [] as string[],
    state: { status: 'running', dashboardUrl: DASHBOARD } as Pick<ServerState, 'status' | 'dashboardUrl'>,
    home: '',
    openExternal: vi.fn(async (url: string) => {
      d.external.push(url);
    }),
    openPath: vi.fn(async (p: string) => {
      d.opened.push(p);
      return '';
    }),
    serverState: () => d.state,
    logsDir: () => path.join(dir, 'logs'),
    appiumHome: (_profile: Profile | undefined) => d.home
  };
  return d;
}

const profile = { id: 'p', server: { appiumHome: '' } } as unknown as Profile;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'xc-open-'));
  mkdirSync(path.join(dir, 'logs'));
  mkdirSync(path.join(dir, 'appium-home'));
  deps = makeDeps();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('server:openDashboard (M8)', () => {
  it('opens main’s own dashboard for the running server, whatever address the window sends', async () => {
    const open = openRequests(deps);
    expect(await open.openDashboard('file:///System/Applications/Calculator.app')).toBe(true);
    expect(await open.openDashboard('https://example.com/phish')).toBe(true);
    expect(await open.openDashboard()).toBe(true);
    expect(deps.external).toEqual([DASHBOARD, DASHBOARD, DASHBOARD]);
  });

  it('opens nothing when no server is running', async () => {
    const open = openRequests(deps);
    for (const state of [
      { status: 'stopped', dashboardUrl: null },
      { status: 'starting', dashboardUrl: null },
      { status: 'crashed', dashboardUrl: null }
    ] as const) {
      deps.state = state;
      expect(await open.openDashboard(DASHBOARD)).toBe(false);
    }
    expect(deps.external).toEqual([]);
  });
});

describe('server:openPath (M8)', () => {
  it('opens the log folder and the profile’s Appium folder', async () => {
    deps.home = path.join(dir, 'appium-home');
    const open = openRequests(deps);
    expect(await open.openPath('logs')).toBe('');
    expect(await open.openPath('appiumHome', profile)).toBe('');
    // The folder itself, its links resolved (the temporary folder is behind /var → /private/var).
    expect(deps.opened).toEqual([realpathSync(path.join(dir, 'logs')), realpathSync(path.join(dir, 'appium-home'))]);
  });

  it('opens no file, above all no program, that an imported profile names as its Appium folder', async () => {
    const script = path.join(dir, 'setup.command');
    writeFileSync(script, '#!/bin/sh\necho owned\n');
    chmodSync(script, 0o755);
    const plain = path.join(dir, 'notes.txt');
    writeFileSync(plain, 'hello');
    const open = openRequests(deps);
    for (const file of [script, plain]) {
      deps.home = file;
      expect(await open.openPath('appiumHome', profile)).toBe('not-a-folder');
    }
    expect(deps.opened).toEqual([]);
  });

  it('opens no app: a folder macOS runs when it is opened is not a folder to look in', async () => {
    const app = path.join(dir, 'Helper.app');
    mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    deps.home = app;
    const open = openRequests(deps);
    expect(await open.openPath('appiumHome', profile)).toBe('not-a-folder');
    deps.home = path.join(dir, 'Thing.PKG');
    mkdirSync(deps.home);
    expect(await open.openPath('appiumHome', profile)).toBe('not-a-folder');
    expect(deps.opened).toEqual([]);
  });

  // R83: a link is followed before anything is checked, so a link to an app, a script or nothing is
  // refused as they are, and what opens is the folder that was checked.
  it('follows a link before it checks: a link to an app or a script is refused, one to a folder opens that folder', async () => {
    const app = path.join(dir, 'Helper.app');
    mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    const script = path.join(dir, 'setup.command');
    writeFileSync(script, '#!/bin/sh\n');
    const open = openRequests(deps);
    for (const [link, to] of [
      ['appium-link', app],
      ['folder-link', script]
    ]) {
      deps.home = path.join(dir, link);
      symlinkSync(to, deps.home);
      expect(await open.openPath('appiumHome', profile)).toBe('not-a-folder');
    }
    deps.home = path.join(dir, 'dangling');
    symlinkSync(path.join(dir, 'gone'), deps.home);
    expect(await open.openPath('appiumHome', profile)).toBe('missing');
    expect(deps.opened).toEqual([]);

    deps.home = path.join(dir, 'Lab.app'); // a link named like an app, to a plain folder: not opened either
    symlinkSync(path.join(dir, 'appium-home'), deps.home);
    expect(await open.openPath('appiumHome', profile)).toBe('not-a-folder');
    deps.home = path.join(dir, 'appium-home-link');
    symlinkSync(path.join(dir, 'appium-home'), deps.home);
    expect(await open.openPath('appiumHome', profile)).toBe('');
    expect(deps.opened).toEqual([realpathSync(path.join(dir, 'appium-home'))]);
  });

  it('says why when the folder is not there', async () => {
    deps.home = path.join(dir, 'gone');
    const open = openRequests(deps);
    expect(await open.openPath('appiumHome', profile)).toBe('missing');
    expect(deps.opened).toEqual([]);
  });

  it('opens nothing for a kind it does not know', async () => {
    deps.home = path.join(dir, 'appium-home');
    const open = openRequests(deps);
    expect(await open.openPath('/etc')).toBe('not-a-folder');
    expect(await open.openPath(undefined)).toBe('not-a-folder');
    expect(deps.opened).toEqual([]);
  });
});
