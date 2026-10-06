import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@shared/types';

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
  buildLaunchPlan: vi.fn(() => ({ args: ['server'], env: {}, spec: { configYaml: '' } }))
}));

import { spawn } from 'node:child_process';
import { ProcessSupervisor, type SupervisorDeps } from '../src/main/ProcessSupervisor';
import { STOP_FORCE_GRACE_MS, STOP_GRACE_MS, STOP_TERM_GRACE_MS } from '../src/main/stopEscalation';

const deps: SupervisorDeps = {
  resolveAppiumHome: () => '/tmp',
  resolveConfigYamlPath: () => '/tmp/config.yml',
  resolveSecrets: () => ({}),
  requiredDefaults: () => ({})
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

function setup() {
  children = [];
  vi.mocked(spawn).mockImplementation((() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }) as unknown as typeof spawn);
  return new ProcessSupervisor(deps);
}

/** Make the fake child look ready, as Appium's own startup line would. */
function markReady(child: FakeChild): void {
  child.stdout.emit('data', Buffer.from('Appium REST http interface listener started on http://0.0.0.0:4723\n'));
}

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
