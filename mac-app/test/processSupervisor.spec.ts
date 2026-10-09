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
import { writeFileSync } from 'node:fs';
import { buildLaunchPlan, skippedSettingsLine } from '../src/main/LaunchBuilder';
import { CRASH_LINES_WAIT_MS, ProcessSupervisor, type SupervisorDeps } from '../src/main/ProcessSupervisor';
import { LOG_LINES_KEPT } from '../src/shared/logView';
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

  it('previews the launch it would make, with the Keychain values, and returns only the renderer-safe spec (I4)', async () => {
    // Fake values only.
    const resolveSecrets = vi.fn(() => ({ PROXY_PASSWORD: 'p-test-1' }));
    const spec = { command: 'appium', args: ['server'], envKeys: ['HTTP_PROXY', 'NO_PROXY'], configYaml: 'server: {}' };
    vi.mocked(buildLaunchPlan).mockReturnValueOnce({
      args: ['server'],
      env: { HTTP_PROXY: 'http://qa:p-test-1@squid.lab:3128' },
      skippedSettings: [],
      spec
    } as unknown as ReturnType<typeof buildLaunchPlan>);
    const supervisor = setup({ ...deps, resolveSecrets });
    const spawned = vi.mocked(spawn).mock.calls.length;
    const written = vi.mocked(writeFileSync).mock.calls.length;
    const preview = supervisor.preview(profile);
    expect(resolveSecrets).toHaveBeenCalledWith(profile);
    expect(buildLaunchPlan).toHaveBeenLastCalledWith(
      profile,
      expect.objectContaining({
        secretValues: { PROXY_PASSWORD: 'p-test-1' },
        inheritedEnv: process.env,
        schema,
        requiredDefaults: { maxSessions: 8 },
        configYamlPath: '/tmp/config.yml',
        appiumHome: '/tmp'
      })
    );
    expect(preview).toBe(spec);
    expect(JSON.stringify(preview)).not.toContain('p-test-1');
    // A preview launches nothing and writes nothing.
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawned);
    expect(vi.mocked(writeFileSync).mock.calls.length).toBe(written);
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

// Settings says "Restart the server to use this." under an Appium folder edited while the server runs.
describe('ProcessSupervisor: the Appium folder a server was started with', () => {
  const launched = {
    id: 'p1',
    name: 'Test profile',
    server: { port: 4799, basePath: '/wd/hub', appiumHome: '/tmp/appium-home' }
  } as unknown as Profile;

  it('is unknown before any start', () => {
    expect(setup().getState().appiumHome).toBeNull();
  });

  it('is the profile’s own setting at the start (empty for the one found on this Mac), kept until the next start', async () => {
    const supervisor = setup();
    await supervisor.start(launched);
    expect(supervisor.getState()).toMatchObject({ status: 'starting', appiumHome: '/tmp/appium-home' });
    markReady(children[0]);
    expect(supervisor.getState()).toMatchObject({ status: 'running', appiumHome: '/tmp/appium-home' });
    children[0].emit('exit', 1, null);
    expect(supervisor.getState().appiumHome).toBe('/tmp/appium-home');
    await supervisor.start({ ...launched, server: { ...launched.server, appiumHome: '' } } as unknown as Profile);
    expect(supervisor.getState().appiumHome).toBe('');
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

// Logs shows system lines only with technical details on, except the ones that tell the person how
// the server ended (spec: Logs). The supervisor marks those `always`.
describe('ProcessSupervisor: which system lines always show', () => {
  /** The log lines (any stream) whose text is `text`. */
  const linesNamed = (supervisor: ProcessSupervisor, text: string | RegExp) =>
    supervisor.getLogs().filter((l) => (typeof text === 'string' ? l.text === text : text.test(l.text)));

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the exit line always', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    children[0].emit('exit', 1, null);
    expect(linesNamed(supervisor, 'Process exited (code=1, signal=null)')).toEqual([
      expect.objectContaining({ stream: 'system', always: true })
    ]);
  });

  it('marks the exit line always after a clean stop too', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    await supervisor.stop();
    children[0].emit('exit', 0, null);
    expect(linesNamed(supervisor, /^Process exited/)).toEqual([expect.objectContaining({ always: true })]);
  });

  it('marks a process error always', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    children[0].emit('error', new Error('spawn appium ENOENT'));
    expect(linesNamed(supervisor, 'Process error: spawn appium ENOENT')).toEqual([
      expect.objectContaining({ stream: 'system', always: true })
    ]);
  });

  it('marks each stop line always: stopping, taking longer than usual, forcing', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    await supervisor.stop();
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + STOP_TERM_GRACE_MS);
    for (const text of ['Stopping Xenon…', 'Xenon is taking longer than usual to stop…', 'Forcing Xenon to stop.']) {
      expect(linesNamed(supervisor, text), text).toEqual([expect.objectContaining({ stream: 'system', always: true })]);
    }
  });

  it('marks the stop line of a forced stop (a second quit) always', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    supervisor.forceStop();
    expect(linesNamed(supervisor, 'Forcing Xenon to stop.')).toEqual([expect.objectContaining({ always: true })]);
  });

  it('leaves the launch lines to technical details: Launching, APPIUM_HOME and the skipped settings', async () => {
    vi.mocked(buildLaunchPlan).mockReturnValueOnce({
      args: ['server'],
      env: {},
      skippedSettings: ['sessionMetrics'],
      spec: { configYaml: '' }
    } as unknown as ReturnType<typeof buildLaunchPlan>);
    vi.mocked(skippedSettingsLine).mockReturnValueOnce('Skipped 1 setting your installed Xenon doesn\'t support: X.');
    const supervisor = setup();
    await supervisor.start(profile);
    const system = supervisor.getLogs().filter((l) => l.stream === 'system');
    expect(system.map((l) => l.text)).toEqual([
      expect.stringMatching(/^Launching: /),
      'APPIUM_HOME=/tmp',
      expect.stringMatching(/^Skipped 1 setting/)
    ]);
    for (const l of system) expect(l.always, l.text).toBeUndefined();
  });

  it('leaves the server’s own output alone', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    children[0].stdout.emit('data', Buffer.from('out line\n'));
    children[0].stderr.emit('data', Buffer.from('err line\n'));
    for (const l of supervisor.getLogs().filter((l) => l.stream !== 'system')) expect(l.always, l.text).toBeUndefined();
  });

  it('carries the mark in what is sent to the window', async () => {
    const supervisor = setup();
    const batches: unknown[][] = [];
    supervisor.on('log', (b: unknown[]) => batches.push(b));
    await supervisor.start(profile);
    children[0].emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(batches.flat()).toContainEqual(
      expect.objectContaining({ text: 'Process exited (code=1, signal=null)', always: true })
    );
  });
});

// R67: main is the source of a run's lines. Every line gets an id that names it in main and in the
// window, the window can read the lines main kept (a window opened after a crash) and clear them,
// and a crash's quote is worked out here, once, from main's own lines.
describe('ProcessSupervisor: the lines main keeps, and their ids (R67)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives every line an id, one counter for the app’s whole life: never reset by a start', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    children[0].stdout.emit('data', Buffer.from('one\ntwo\n'));
    const first = supervisor.getLogs().map((l) => l.id);
    expect(first.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
    expect(first).toEqual([...first].sort((a, b) => a - b));
    expect(new Set(first).size).toBe(first.length);
    children[0].emit('exit', 1, null);
    const lastOfFirstRun = Math.max(...supervisor.getLogs().map((l) => l.id));

    await supervisor.start(profile);
    const second = supervisor.getLogs().map((l) => l.id);
    expect(second.length).toBeGreaterThan(0);
    expect(Math.min(...second)).toBeGreaterThan(lastOfFirstRun);
  });

  it('sends the window each line with the id it keeps it by', async () => {
    const supervisor = setup();
    const sent: Array<{ id: number; text: string }> = [];
    supervisor.on('log', (b: Array<{ id: number; text: string }>) => sent.push(...b));
    await supervisor.start(profile);
    children[0].stderr.emit('data', Buffer.from('[Appium] Error: boom\n'));
    await vi.advanceTimersByTimeAsync(1_000);
    const kept = supervisor.getLogs();
    expect(sent.map((l) => [l.id, l.text])).toEqual(kept.map((l) => [l.id, l.text]));
  });

  it('keeps as many lines as the window does, dropping the oldest', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    const many = Array.from({ length: LOG_LINES_KEPT + 10 }, (_, i) => `line ${i}`).join('\n');
    children[0].stdout.emit('data', Buffer.from(`${many}\n`));
    const kept = supervisor.getLogs();
    expect(kept).toHaveLength(LOG_LINES_KEPT);
    expect(kept[kept.length - 1].text).toBe(`line ${LOG_LINES_KEPT + 9}`);
  });

  it('clears the lines the window cleared, through the last one it had, and keeps the later ones', async () => {
    const supervisor = setup();
    await supervisor.start(profile);
    children[0].stdout.emit('data', Buffer.from('a\nb\nc\n'));
    const [, b] = supervisor.getLogs().filter((l) => l.stream === 'stdout');
    supervisor.clearLogs(b.id);
    expect(supervisor.getLogs().map((l) => l.text)).toEqual(['c']);
    supervisor.clearLogs(Number.MAX_SAFE_INTEGER);
    expect(supervisor.getLogs()).toEqual([]);
  });

  it('keeps the app’s own lines (a diagnostic, an update) with the run’s, with ids, and sends them', async () => {
    const supervisor = setup();
    const sent: Array<{ id: number; text: string; always?: boolean }> = [];
    supervisor.on('log', (b: typeof sent) => sent.push(...b));
    supervisor.note('⚠ Main thread stalled for 2 s');
    supervisor.note('Update downloaded — restart to apply.', { always: true });
    expect(supervisor.getLogs()).toEqual([
      expect.objectContaining({ stream: 'system', text: '⚠ Main thread stalled for 2 s' }),
      expect.objectContaining({ stream: 'system', text: 'Update downloaded — restart to apply.', always: true })
    ]);
    expect(supervisor.getLogs()[0].always).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.map((l) => l.id)).toEqual(supervisor.getLogs().map((l) => l.id));
  });
});

describe('ProcessSupervisor: the crash’s line, frozen in the server’s state (R67)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A run that printed `out` and `err`, and is running. */
  async function running(out: string[] = [], err: string[] = []) {
    const supervisor = setup();
    await supervisor.start(profile);
    const child = children[children.length - 1];
    markReady(child);
    for (const text of out) child.stdout.emit('data', Buffer.from(`${text}\n`));
    for (const text of err) child.stderr.emit('data', Buffer.from(`${text}\n`));
    return { supervisor, child };
  }

  it('is null before any crash', () => {
    expect(setup().getState().crashLine).toBeNull();
  });

  it('is the server’s last problem line at a crash: its id and its words without colour codes', async () => {
    const { supervisor, child } = await running([], ['\x1b[31m[Appium]\x1b[39m Error: listen EADDRINUSE: address already in use 0.0.0.0:4797']);
    const quoted = supervisor.getLogs().find((l) => l.text.includes('EADDRINUSE'))!;
    child.emit('exit', 1, null);
    expect(supervisor.getState()).toMatchObject({
      status: 'crashed',
      crashLine: { id: quoted.id, text: '[Appium] Error: listen EADDRINUSE: address already in use 0.0.0.0:4797' }
    });
  });

  it('includes the lines that come after the exit, once the server’s output has closed', async () => {
    const { supervisor, child } = await running(['[Appium] Welcome to Appium']);
    const states: Array<{ status: string; crashLine: unknown }> = [];
    supervisor.on('state', (s) => states.push({ status: s.status, crashLine: s.crashLine }));
    child.emit('exit', 1, null);
    // The error the server printed as it died is still on its way.
    child.stderr.emit('data', Buffer.from('[Appium] Error: listen EADDRINUSE: address already in use 0.0.0.0:4797\n'));
    child.emit('close', 1, null);
    const late = supervisor.getLogs().find((l) => l.text.includes('EADDRINUSE'))!;
    expect(supervisor.getState().crashLine).toEqual({ id: late.id, text: late.text });
    expect(states.at(-1)).toEqual({ status: 'crashed', crashLine: { id: late.id, text: late.text } });
  });

  it('settles without the close when the output stays open (a helper the server started holds it)', async () => {
    const { supervisor, child } = await running();
    child.emit('exit', 1, null);
    child.stderr.emit('data', Buffer.from('[Appium] Error: late\n'));
    expect(supervisor.getState().crashLine).toBeNull();
    await vi.advanceTimersByTimeAsync(CRASH_LINES_WAIT_MS);
    expect(supervisor.getState().crashLine).toMatchObject({ text: '[Appium] Error: late' });
    // A close after that changes nothing.
    child.stderr.emit('data', Buffer.from('[Appium] Error: later still\n'));
    child.emit('close', 1, null);
    expect(supervisor.getState().crashLine).toMatchObject({ text: '[Appium] Error: late' });
  });

  it('announces the state again only when the late lines change the line', async () => {
    const { supervisor, child } = await running([], ['[Appium] Error: boom']);
    const seen: string[] = [];
    supervisor.on('state', (s) => seen.push(s.status));
    child.emit('exit', 1, null);
    child.stdout.emit('data', Buffer.from('ordinary\n'));
    child.emit('close', 1, null);
    expect(seen).toEqual(['crashed']);
  });

  it('is never the app’s own lines: a kill with no error from the server quotes nothing (R68)', async () => {
    const { supervisor, child } = await running(['[Appium] Welcome to Appium']);
    child.emit('exit', null, 'SIGKILL');
    child.emit('close', null, 'SIGKILL');
    expect(supervisor.getState()).toMatchObject({ status: 'crashed', crashLine: null });
  });

  it('is null after a requested stop, and after a clean exit', async () => {
    const stopped = await running([], ['[Appium] Error: boom']);
    await stopped.supervisor.stop();
    stopped.child.emit('exit', 0, null);
    stopped.child.emit('close', 0, null);
    expect(stopped.supervisor.getState()).toMatchObject({ status: 'stopped', crashLine: null });

    const forced = await running([], ['[Appium] Error: boom']);
    await forced.supervisor.stop();
    forced.child.emit('exit', null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(CRASH_LINES_WAIT_MS);
    expect(forced.supervisor.getState()).toMatchObject({ status: 'stopped', crashLine: null });

    const clean = await running([], ['[Appium] Error: boom']);
    clean.child.emit('exit', 0, null);
    expect(clean.supervisor.getState()).toMatchObject({ status: 'stopped', crashLine: null });
  });

  it('is cleared by the next start, and a late close from the run before does not bring it back', async () => {
    const { supervisor, child } = await running([], ['[Appium] Error: boom']);
    child.emit('exit', 1, null);
    expect(supervisor.getState().crashLine).not.toBeNull();
    await supervisor.start(profile);
    expect(supervisor.getState()).toMatchObject({ status: 'starting', crashLine: null });
    child.emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(CRASH_LINES_WAIT_MS);
    expect(supervisor.getState().crashLine).toBeNull();
  });

  it('is not changed by a Clear, before or after the output closes', async () => {
    const { supervisor, child } = await running([], ['[Appium] Error: listen EADDRINUSE']);
    child.emit('exit', 1, null);
    const before = supervisor.getState().crashLine;
    supervisor.clearLogs(Number.MAX_SAFE_INTEGER);
    child.emit('close', 1, null);
    expect(supervisor.getState().crashLine).toEqual(before);
    supervisor.clearLogs(Number.MAX_SAFE_INTEGER);
    expect(supervisor.getState().crashLine).toEqual(before);
  });

  it('marks a crash’s exit line a problem, and a requested stop’s not (R68)', async () => {
    const crashed = await running();
    crashed.child.emit('exit', null, 'SIGKILL');
    expect(crashed.supervisor.getLogs().filter((l) => /^Process exited/.test(l.text))).toEqual([
      expect.objectContaining({ text: 'Process exited (code=null, signal=SIGKILL)', always: true, problem: true })
    ]);

    const stopped = await running();
    await stopped.supervisor.stop();
    stopped.child.emit('exit', 0, null);
    const [exit] = stopped.supervisor.getLogs().filter((l) => /^Process exited/.test(l.text));
    expect(exit.always).toBe(true);
    expect(exit.problem).toBeUndefined();
  });
});
