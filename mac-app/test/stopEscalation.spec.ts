import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STOP_GRACE_MS, STOP_TERM_GRACE_MS, StopEscalator } from '../src/main/stopEscalation';

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
});
