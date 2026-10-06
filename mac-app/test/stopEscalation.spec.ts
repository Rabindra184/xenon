import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STOP_FORCE_GRACE_MS, STOP_GRACE_MS, STOP_TERM_GRACE_MS, StopEscalator } from '../src/main/stopEscalation';

function setup() {
  const kill = vi.fn<(signal: NodeJS.Signals) => void>();
  const log = vi.fn<(text: string) => void>();
  const escalator = new StopEscalator({ kill, log });
  return { kill, log, escalator };
}

describe('StopEscalator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a 30 s grace then a 5 s terminate window', () => {
    expect(STOP_GRACE_MS).toBe(30_000);
    expect(STOP_TERM_GRACE_MS).toBe(5_000);
  });

  it('gives a forced stop 2 s of SIGTERM before SIGKILL', () => {
    expect(STOP_FORCE_GRACE_MS).toBe(2_000);
  });

  it('begin sends SIGINT once and logs "Stopping Xenon…"', () => {
    const { kill, log, escalator } = setup();
    escalator.begin();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGINT');
    expect(log).toHaveBeenCalledWith('Stopping Xenon…');
    expect(escalator.active).toBe(true);
  });

  it('sends no SIGTERM before 30 s, then SIGTERM at 30 s with a log line', () => {
    const { kill, log, escalator } = setup();
    escalator.begin();
    vi.advanceTimersByTime(29_999);
    expect(kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenLastCalledWith('SIGTERM');
    expect(log).toHaveBeenCalledWith('Xenon is taking longer than usual to stop…');
  });

  it('sends SIGKILL at 35 s with a log line', () => {
    const { kill, log, escalator } = setup();
    escalator.begin();
    vi.advanceTimersByTime(34_999);
    expect(kill).not.toHaveBeenCalledWith('SIGKILL');
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(3);
    expect(kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(log).toHaveBeenCalledWith('Forcing Xenon to stop.');
  });

  it('exited() cancels pending escalation', () => {
    const { kill, escalator } = setup();
    escalator.begin();
    escalator.exited();
    expect(escalator.active).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGINT');
  });

  it('exited() after SIGTERM cancels the pending SIGKILL', () => {
    const { kill, escalator } = setup();
    escalator.begin();
    vi.advanceTimersByTime(30_000);
    escalator.exited();
    vi.advanceTimersByTime(60_000);
    expect(kill).not.toHaveBeenCalledWith('SIGKILL');
  });

  it('a second begin() while active sends nothing and does not reset timers', () => {
    const { kill, log, escalator } = setup();
    escalator.begin();
    vi.advanceTimersByTime(10_000);
    escalator.begin();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    // 20 s later is 30 s from the FIRST begin(); a reset would delay this to 40 s.
    vi.advanceTimersByTime(20_000);
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenLastCalledWith('SIGTERM');
  });

  it('force() sends SIGKILL immediately and cancels timers', () => {
    const { kill, log, escalator } = setup();
    escalator.begin();
    vi.advanceTimersByTime(5_000);
    escalator.force();
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(log).toHaveBeenCalledWith('Forcing Xenon to stop.');
    vi.advanceTimersByTime(60_000);
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it('exited() before begin() is a no-op, and begin() after exited() starts a fresh escalation', () => {
    const { kill, escalator } = setup();
    escalator.exited();
    expect(escalator.active).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(kill).not.toHaveBeenCalled();

    escalator.begin();
    expect(kill).toHaveBeenCalledTimes(1);
    escalator.exited();
    vi.advanceTimersByTime(10_000);

    escalator.begin();
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenLastCalledWith('SIGINT');
    vi.advanceTimersByTime(29_999);
    expect(kill).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenLastCalledWith('SIGTERM');
  });

  it('honours custom grace windows', () => {
    const kill = vi.fn<(signal: NodeJS.Signals) => void>();
    const escalator = new StopEscalator({ kill, log: vi.fn(), graceMs: 100, termGraceMs: 50 });
    escalator.begin();
    vi.advanceTimersByTime(100);
    expect(kill).toHaveBeenLastCalledWith('SIGTERM');
    vi.advanceTimersByTime(50);
    expect(kill).toHaveBeenLastCalledWith('SIGKILL');
  });

  describe('forceQuick() (a second quit)', () => {
    it('sends SIGTERM now, then SIGKILL after 2 s, logging "Forcing Xenon to stop." once', () => {
      const { kill, log, escalator } = setup();
      escalator.forceQuick();
      expect(escalator.active).toBe(true);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenLastCalledWith('SIGTERM');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('Forcing Xenon to stop.');
      vi.advanceTimersByTime(STOP_FORCE_GRACE_MS - 1);
      expect(kill).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(kill).toHaveBeenCalledTimes(2);
      expect(kill).toHaveBeenLastCalledWith('SIGKILL');
      // Nothing further is scheduled.
      vi.advanceTimersByTime(60_000);
      expect(kill).toHaveBeenCalledTimes(2);
    });

    it('sends no SIGKILL if the child exits within the 2 s', () => {
      const { kill, escalator } = setup();
      escalator.forceQuick();
      vi.advanceTimersByTime(1_999);
      escalator.exited();
      vi.advanceTimersByTime(60_000);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith('SIGTERM');
      expect(kill).not.toHaveBeenCalledWith('SIGKILL');
      expect(escalator.active).toBe(false);
    });

    it('during the SIGINT wait it replaces the ladder: SIGTERM now, SIGKILL 2 s later, not at 30 s', () => {
      const { kill, escalator } = setup();
      escalator.begin();
      vi.advanceTimersByTime(5_000);
      escalator.forceQuick();
      expect(kill.mock.calls.map((c) => c[0])).toEqual(['SIGINT', 'SIGTERM']);
      vi.advanceTimersByTime(2_000);
      expect(kill.mock.calls.map((c) => c[0])).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
      // The ladder's own 30 s / 35 s steps are gone.
      vi.advanceTimersByTime(60_000);
      expect(kill).toHaveBeenCalledTimes(3);
    });

    it('after the ladder has already sent SIGTERM it sends SIGKILL at once and cancels the 35 s step', () => {
      const { kill, log, escalator } = setup();
      escalator.begin();
      vi.advanceTimersByTime(STOP_GRACE_MS);
      expect(kill).toHaveBeenLastCalledWith('SIGTERM');
      escalator.forceQuick();
      expect(kill).toHaveBeenCalledTimes(3);
      expect(kill).toHaveBeenLastCalledWith('SIGKILL');
      expect(log).toHaveBeenLastCalledWith('Forcing Xenon to stop.');
      vi.advanceTimersByTime(60_000);
      expect(kill).toHaveBeenCalledTimes(3);
    });

    it('a repeat forceQuick() after its SIGTERM sends SIGKILL at once', () => {
      const { kill, escalator } = setup();
      escalator.forceQuick();
      vi.advanceTimersByTime(500);
      escalator.forceQuick();
      expect(kill.mock.calls.map((c) => c[0])).toEqual(['SIGTERM', 'SIGKILL']);
      vi.advanceTimersByTime(60_000);
      expect(kill).toHaveBeenCalledTimes(2);
    });

    it('a fresh run after exited() starts from SIGTERM again, not an immediate SIGKILL', () => {
      const { kill, escalator } = setup();
      escalator.begin();
      vi.advanceTimersByTime(STOP_GRACE_MS);
      escalator.exited();
      kill.mockClear();
      escalator.forceQuick();
      expect(kill.mock.calls.map((c) => c[0])).toEqual(['SIGTERM']);
    });

    it('honours a custom force grace', () => {
      const kill = vi.fn<(signal: NodeJS.Signals) => void>();
      const escalator = new StopEscalator({ kill, log: vi.fn(), forceGraceMs: 40 });
      escalator.forceQuick();
      vi.advanceTimersByTime(39);
      expect(kill).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(kill).toHaveBeenLastCalledWith('SIGKILL');
    });
  });

  describe('exited() called synchronously from kill() (child "error" emitted inside kill)', () => {
    function setupSyncExit(onSignal: (s: NodeJS.Signals) => boolean) {
      const calls: NodeJS.Signals[] = [];
      const kill = vi.fn((signal: NodeJS.Signals) => {
        calls.push(signal);
        if (onSignal(signal)) escalator.exited();
      });
      const escalator: StopEscalator = new StopEscalator({ kill, log: vi.fn() });
      return { calls, kill, escalator };
    }

    it('begin(): leaves no timer armed for the next run', () => {
      const { kill, escalator } = setupSyncExit(() => true);
      escalator.begin();
      expect(escalator.active).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith('SIGINT');
    });

    it('the SIGTERM step: leaves no SIGKILL armed', () => {
      const { calls, escalator } = setupSyncExit((s) => s === 'SIGTERM');
      escalator.begin();
      vi.advanceTimersByTime(STOP_GRACE_MS);
      expect(calls).toEqual(['SIGINT', 'SIGTERM']);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(calls).toEqual(['SIGINT', 'SIGTERM']);
    });

    it('forceQuick(): leaves no SIGKILL armed', () => {
      const { calls, escalator } = setupSyncExit(() => true);
      escalator.forceQuick();
      expect(escalator.active).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(calls).toEqual(['SIGTERM']);
    });

    it('a stale step never reaches the next run', () => {
      let exitInKill = true;
      const calls: NodeJS.Signals[] = [];
      const escalator: StopEscalator = new StopEscalator({
        kill: (signal) => {
          calls.push(signal);
          if (exitInKill) escalator.exited();
        },
        log: vi.fn()
      });
      escalator.begin(); // the first run's SIGINT exits synchronously
      exitInKill = false;
      calls.length = 0;
      vi.advanceTimersByTime(10_000);
      escalator.begin(); // the next run
      // A stale first-run timer would fire a SIGTERM 20 s into this window.
      vi.advanceTimersByTime(STOP_GRACE_MS - 1);
      expect(calls).toEqual(['SIGINT']);
      vi.advanceTimersByTime(1);
      expect(calls).toEqual(['SIGINT', 'SIGTERM']);
    });
  });
});
