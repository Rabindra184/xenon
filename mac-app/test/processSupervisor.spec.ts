import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, XenonSchema } from '@shared/types';

// Drives the REAL ProcessSupervisor against a fake child process and fake
// timers, so the stop wiring (escalator <-> child <-> status <-> waiters) is
// covered end to end without spawning anything.

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(() => ({ write: vi.fn(), end: vi.fn() }))
}));
vi.mock('../src/main/env', () => ({
  which: vi.fn(async () => '/usr/local/bin/appium'),
  buildEnv: vi.fn(async () => ({}))
}));
vi.mock('../src/main/paths', () => ({ logsDir: () => '/tmp/logs' }));
vi.mock('../src/main/LaunchBuilder', () => ({
  buildLaunchPlan: vi.fn(() => ({ args: ['server'], env: {}, skippedSettings: [], spec: { configYaml: '' } })),
  skippedSettingsLine: vi.fn(() => null)
}));

import { spawn } from 'node:child_process';
import { buildLaunchPlan, skippedSettingsLine } from '../src/main/LaunchBuilder';
import { ProcessSupervisor, type SupervisorDeps } from '../src/main/ProcessSupervisor';
import { STOP_FORCE_GRACE_MS, STOP_GRACE_MS, STOP_TERM_GRACE_MS } from '../src/main/stopEscalation';

const schema = {
  type: 'object',
  properties: { maxSessions: { default: 8 } },
  required: ['maxSessions']
} as unknown as XenonSchema;

const deps: SupervisorDeps = {
  resolveAppiumHome: () => '/tmp',
  resolveConfigYamlPath: () => '/tmp/config.yml',
  resolveSecrets: () => ({}),
  schemaFor: () => schema
};

const profile = { id: 'p1', name: 'Test profile', server: { port: 4723 } } as unknown as Profile;

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
  /** The signals sent to this child, in order. */
  get signals(): unknown[] {
    return this.kill.mock.calls.map((c) => c[0]);
  }
}

let children: FakeChild[];

function setup(supervisorDeps: SupervisorDeps = deps) {
  children = [];
  vi.mocked(spawn).mockImplementation((() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }) as unknown as typeof spawn);
  return new ProcessSupervisor(supervisorDeps);
}

/** Make the fake child look ready, as Appium's own startup line would. */
function markReady(child: FakeChild): void {
  child.stdout.emit('data', Buffer.from('Appium REST http interface listener started on http://0.0.0.0:4723\n'));
}

describe('ProcessSupervisor launch plan', () => {
  it("builds the plan from the profile's installed option list and the defaults it requires", async () => {
    const schemaFor = vi.fn(() => schema);
    const supervisor = setup({ ...deps, schemaFor });
    await supervisor.start(profile);
    expect(schemaFor).toHaveBeenCalledWith(profile);
    expect(buildLaunchPlan).toHaveBeenLastCalledWith(
      profile,
      expect.objectContaining({ schema, requiredDefaults: { maxSessions: 8 } })
    );
  });

  it('logs the skipped-settings line as a system line when something was skipped', async () => {
    vi.mocked(buildLaunchPlan).mockReturnValueOnce({
      args: ['server'],
      env: {},
      skippedSettings: ['sessionMetrics'],
      spec: { configYaml: '' }
    } as unknown as ReturnType<typeof buildLaunchPlan>);
    vi.mocked(skippedSettingsLine).mockReturnValueOnce('Skipped 1 setting your installed Xenon doesn\'t support: X.');
    const supervisor = setup();
    await supervisor.start(profile);
    expect(skippedSettingsLine).toHaveBeenLastCalledWith(['sessionMetrics']);
    expect(supervisor.getLogs()).toContainEqual(
      expect.objectContaining({ stream: 'system', text: "Skipped 1 setting your installed Xenon doesn't support: X." })
    );
  });

  it('passes the environment the server inherits, for the NO_PROXY in force', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    expect(buildLaunchPlan).toHaveBeenLastCalledWith(profile, expect.objectContaining({ inheritedEnv: process.env }));
  });

  it('logs the command and its arguments, never the environment that carries the secrets', async () => {
    // Fake values only.
    const env = { CLOUD_KEY: 'k-test-123', HTTPS_PROXY: 'http://qa:p%40ss%3Aw%2Frd@squid.lab:3128' };
    vi.mocked(buildLaunchPlan).mockReturnValueOnce({
      args: ['server', '--config', '/tmp/config.yml'],
      env,
      skippedSettings: [],
      spec: { configYaml: '' }
    } as unknown as ReturnType<typeof buildLaunchPlan>);
    const supervisor = setup();
    await supervisor.start(profile);
    const lines = supervisor.getLogs().map((l) => l.text);
    expect(lines).toContain('Launching: /usr/local/bin/appium server --config /tmp/config.yml');
    expect(lines.join('\n')).not.toMatch(/k-test-123|p%40ss|CLOUD_KEY|HTTPS_PROXY/);
  });

  it('adds no line when nothing was skipped', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    expect(supervisor.getLogs().some((l) => l.text.startsWith('Skipped'))).toBe(false);
  });
});

// The address tests connect to is the one the server serves: its port and base path as launched,
// not as the profile is being edited since.
describe('ProcessSupervisor: the base path a server was started with', () => {
  const launched = { id: 'p1', name: 'Test profile', server: { port: 4799, basePath: '/wd/hub' } } as unknown as Profile;

  it('is unknown before any start', () => {
    expect(setup().getState().basePath).toBeNull();
  });

  it('is the profile’s at the start, and stays through running, as the port does', async () => {
    const supervisor = setup();
    await supervisor.start(launched);
    expect(supervisor.getState()).toMatchObject({ status: 'starting', port: 4799, basePath: '/wd/hub' });
    markReady(children[0]);
    expect(supervisor.getState()).toMatchObject({ status: 'running', port: 4799, basePath: '/wd/hub' });
  });

  it('is kept while it stops, and after it ended, as the port is', async () => {
    const supervisor = setup();
    await supervisor.start(launched);
    markReady(children[0]);
    await supervisor.stop();
    expect(supervisor.getState()).toMatchObject({ status: 'stopping', basePath: '/wd/hub' });
    children[0].emit('exit', 0, null);
    expect(supervisor.getState()).toMatchObject({ status: 'stopped', port: 4799, basePath: '/wd/hub' });
  });

  it('is the new profile’s on the next start', async () => {
    const supervisor = setup();
    await supervisor.start(launched);
    children[0].emit('exit', 1, null);
    await supervisor.start({ ...launched, server: { port: 4800, basePath: '' } } as unknown as Profile);
    expect(supervisor.getState()).toMatchObject({ status: 'starting', port: 4800, basePath: '' });
  });
});

describe('ProcessSupervisor stop wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stop() sends SIGINT; exit(0) resolves whenStopped() as Stopped and nothing more is sent', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    const [child] = children;
    markReady(child);
    expect(supervisor.getState().status).toBe('running');

    await supervisor.stop();
    expect(supervisor.getState().status).toBe('stopping');
    expect(child.signals).toEqual(['SIGINT']);

    let stopped = false;
    void supervisor.whenStopped().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stopped).toBe(false);

    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(true);
    expect(supervisor.getState()).toMatchObject({ status: 'stopped', pid: null, exitCode: 0, lastError: null });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.signals).toEqual(['SIGINT']);
  });

  it('whenStopped() resolves at once when no child is running', async () => {
    const supervisor = setup();
    await expect(supervisor.whenStopped()).resolves.toBeUndefined();
  });

  it('escalates SIGINT, SIGTERM at 30 s, SIGKILL at 35 s if the child never exits', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    const [child] = children;
    await supervisor.stop();
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 1);
    expect(child.signals).toEqual(['SIGINT']);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.signals).toEqual(['SIGINT', 'SIGTERM']);
    await vi.advanceTimersByTimeAsync(STOP_TERM_GRACE_MS);
    expect(child.signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
  });

  it('start, stop, exit, start, stop sends SIGINT to the NEW child, and no stale SIGTERM or SIGKILL reaches it', async () => {
    const supervisor = setup();

    await supervisor.start(profile);
    const [first] = children;
    await supervisor.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    first.emit('exit', 0, null);
    expect(supervisor.getState().status).toBe('stopped');

    await supervisor.start(profile);
    const second = children[1];
    expect(second).not.toBe(first);
    await supervisor.stop();
    expect(second.signals).toEqual(['SIGINT']);

    // The first stop's SIGTERM would have been due 20 s into this window, its
    // SIGKILL 25 s in. Neither may land on the second child.
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 1);
    expect(second.signals).toEqual(['SIGINT']);
    // Its own ladder still runs, from its own stop().
    await vi.advanceTimersByTimeAsync(1);
    expect(second.signals).toEqual(['SIGINT', 'SIGTERM']);

    second.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(second.signals).toEqual(['SIGINT', 'SIGTERM']);
    expect(first.signals).toEqual(['SIGINT']);
  });

  it('after a forced stop, the next run stops with its own SIGINT and no stale SIGKILL', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    const [first] = children;
    supervisor.forceStop();
    await vi.advanceTimersByTimeAsync(1_000);
    first.emit('exit', null, 'SIGTERM');

    await supervisor.start(profile);
    const second = children[1];
    await supervisor.stop();
    // The first run's SIGKILL was due 1 s from here; it must not reach the new child.
    await vi.advanceTimersByTimeAsync(STOP_FORCE_GRACE_MS);
    expect(second.signals).toEqual(['SIGINT']);
    expect(first.signals).toEqual(['SIGTERM']);
  });

  it('spawn "error" releases whenStopped() waiters and ends the stop run', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    const [first] = children;
    await supervisor.stop();

    let stopped = false;
    void supervisor.whenStopped().then(() => {
      stopped = true;
    });
    first.emit('error', new Error('spawn appium ENOENT'));
    await vi.advanceTimersByTimeAsync(0);

    expect(stopped).toBe(true);
    expect(supervisor.getState()).toMatchObject({ status: 'crashed', lastError: 'spawn appium ENOENT' });

    // The errored run must not leave the escalator stuck or a timer armed: the
    // next child stops with its own SIGINT and none of the old run's signals.
    await vi.advanceTimersByTimeAsync(10_000);
    await supervisor.start(profile);
    const second = children[1];
    await supervisor.stop();
    expect(second.signals).toEqual(['SIGINT']);
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 1);
    expect(second.signals).toEqual(['SIGINT']);
    expect(first.signals).toEqual(['SIGINT']);
  });

  describe('forceStop()', () => {
    it('from running: announces stopping once, sends SIGTERM now and SIGKILL after 2 s', async () => {
      const supervisor = setup();
      await supervisor.start(profile);
      const [child] = children;
      markReady(child);

      const seen: string[] = [];
      supervisor.on('state', (s) => seen.push(s.status));
      supervisor.forceStop();
      expect(seen).toEqual(['stopping']);
      expect(supervisor.getState().status).toBe('stopping');
      expect(child.signals).toEqual(['SIGTERM']);

      await vi.advanceTimersByTimeAsync(STOP_FORCE_GRACE_MS - 1);
      expect(child.signals).toEqual(['SIGTERM']);
      await vi.advanceTimersByTimeAsync(1);
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);

      child.emit('exit', null, 'SIGKILL');
      expect(supervisor.getState()).toMatchObject({
        status: 'stopped',
        exitCode: null,
        exitSignal: 'SIGKILL',
        lastError: null
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    });

    it('lets the child exit on SIGTERM within 2 s without a SIGKILL', async () => {
      const supervisor = setup();
      await supervisor.start(profile);
      const [child] = children;
      markReady(child);
      supervisor.forceStop();
      await vi.advanceTimersByTimeAsync(1_000);
      child.emit('exit', null, 'SIGTERM');
      expect(supervisor.getState()).toMatchObject({ status: 'stopped', lastError: null });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(child.signals).toEqual(['SIGTERM']);
    });

    it('while already stopping: no extra state event; SIGTERM now, SIGKILL 2 s later', async () => {
      const supervisor = setup();
      await supervisor.start(profile);
      const [child] = children;
      await supervisor.stop();
      await vi.advanceTimersByTimeAsync(5_000);

      const seen: string[] = [];
      supervisor.on('state', (s) => seen.push(s.status));
      supervisor.forceStop();
      expect(seen).toEqual([]);
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM']);
      await vi.advanceTimersByTimeAsync(STOP_FORCE_GRACE_MS);
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
      // The ladder's own 30 s / 35 s steps were replaced, not added to.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
    });

    it('after the ladder already sent SIGTERM: SIGKILL at once', async () => {
      const supervisor = setup();
      await supervisor.start(profile);
      const [child] = children;
      await supervisor.stop();
      await vi.advanceTimersByTimeAsync(STOP_GRACE_MS);
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM']);

      supervisor.forceStop();
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
    });

    it('does nothing when no child is running', () => {
      const supervisor = setup();
      supervisor.forceStop();
      expect(supervisor.getState().status).toBe('stopped');
      expect(children).toHaveLength(0);
    });
  });
});
