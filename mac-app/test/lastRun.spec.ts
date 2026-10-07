import { describe, expect, it, vi } from 'vitest';
import { forgetLastRun, lastRunFrom, lastRunRecorder, sanitizeLastRun } from '../src/main/lastRun';
import type { LastRun, ServerState, ServerStatus } from '../src/shared/types';

const NOW = 1_800_000_000_000;

function state(status: ServerStatus, patch: Partial<ServerState> = {}): ServerState {
  return {
    status,
    profileId: 'p1',
    pid: null,
    port: 4723,
    dashboardUrl: null,
    startedAt: null,
    logFile: null,
    exitCode: null,
    exitSignal: null,
    lastError: null,
    basePath: null,
    ...patch
  };
}

describe('lastRunFrom', () => {
  it('records a stop: running to stopped', () => {
    expect(lastRunFrom(state('running'), state('stopped'), NOW)).toEqual({
      profileId: 'p1',
      run: { endedAt: NOW, how: 'stopped' }
    });
  });

  it('records a crash with its reason: running to crashed', () => {
    const next = state('crashed', { lastError: 'Appium exited with code 1', exitCode: 1 });
    expect(lastRunFrom(state('running'), next, NOW)).toEqual({
      profileId: 'p1',
      run: { endedAt: NOW, how: 'crashed', reason: 'Appium exited with code 1' }
    });
  });

  it('records a crash while starting: starting to crashed', () => {
    const next = state('crashed', { lastError: 'Port 4723 is busy' });
    expect(lastRunFrom(state('starting'), next, NOW)).toEqual({
      profileId: 'p1',
      run: { endedAt: NOW, how: 'crashed', reason: 'Port 4723 is busy' }
    });
  });

  it('records the end of a stop: stopping to stopped', () => {
    expect(lastRunFrom(state('stopping'), state('stopped'), NOW)?.run.how).toBe('stopped');
  });

  it('records a crash while stopping', () => {
    const next = state('crashed', { lastError: 'Appium exited with code 137' });
    expect(lastRunFrom(state('stopping'), next, NOW)?.run).toEqual({
      endedAt: NOW,
      how: 'crashed',
      reason: 'Appium exited with code 137'
    });
  });

  it('has no reason key at all for a stop, rather than reason: undefined', () => {
    const out = lastRunFrom(state('running'), state('stopped'), NOW);
    expect(out && 'reason' in out.run).toBe(false);
  });

  it('records nothing for stopped to stopped', () => {
    expect(lastRunFrom(state('stopped'), state('stopped'), NOW)).toBeNull();
  });

  it('records nothing for a start that fails before any run: stopped to crashed', () => {
    expect(lastRunFrom(state('stopped'), state('crashed', { lastError: 'no appium' }), NOW)).toBeNull();
  });

  it('records the crash only once when a second event follows it: crashed to stopped or crashed', () => {
    expect(lastRunFrom(state('crashed'), state('stopped'), NOW)).toBeNull();
    expect(lastRunFrom(state('crashed'), state('crashed'), NOW)).toBeNull();
  });

  it('records nothing for changes that are not the end of a run', () => {
    const live: ServerStatus[] = ['starting', 'running', 'stopping'];
    for (const a of live) {
      for (const b of live) expect(lastRunFrom(state(a), state(b), NOW)).toBeNull();
    }
    expect(lastRunFrom(state('stopped'), state('starting'), NOW)).toBeNull();
    expect(lastRunFrom(state('crashed'), state('starting'), NOW)).toBeNull();
  });

  it('records nothing when it is not known which profile ran', () => {
    expect(lastRunFrom(state('running', { profileId: null }), state('stopped', { profileId: null }), NOW)).toBeNull();
  });

  it('names the profile that ran (before), not the one named after', () => {
    const out = lastRunFrom(state('running', { profileId: 'a' }), state('stopped', { profileId: 'b' }), NOW);
    expect(out?.profileId).toBe('a');
  });

  it('treats an empty error as no reason', () => {
    const out = lastRunFrom(state('running'), state('crashed', { lastError: null }), NOW);
    expect(out?.run).toEqual({ endedAt: NOW, how: 'crashed' });
  });
});

describe('sanitizeLastRun', () => {
  it('passes a good run through, keeping only what it knows', () => {
    expect(sanitizeLastRun({ endedAt: NOW, how: 'crashed', reason: 'x', extra: 1 })).toEqual({
      endedAt: NOW,
      how: 'crashed',
      reason: 'x'
    });
    expect(sanitizeLastRun({ endedAt: NOW, how: 'stopped' })).toEqual({ endedAt: NOW, how: 'stopped' });
  });

  it('gives null for anything that is not a run', () => {
    for (const bad of [
      null,
      undefined,
      42,
      'stopped',
      [],
      {},
      { endedAt: NOW },
      { how: 'stopped' },
      { endedAt: 'yesterday', how: 'stopped' },
      { endedAt: Number.NaN, how: 'stopped' },
      { endedAt: Infinity, how: 'stopped' },
      { endedAt: NOW, how: 'exploded' }
    ]) {
      expect(sanitizeLastRun(bad)).toBeNull();
    }
  });

  it('drops a reason that is not text', () => {
    expect(sanitizeLastRun({ endedAt: NOW, how: 'crashed', reason: 7 })).toEqual({ endedAt: NOW, how: 'crashed' });
    expect(sanitizeLastRun({ endedAt: NOW, how: 'crashed', reason: '' })).toEqual({ endedAt: NOW, how: 'crashed' });
  });
});

describe('lastRunRecorder', () => {
  function recorder(initial: ServerState = state('stopped', { profileId: null })) {
    const kept: Array<{ profileId: string; run: LastRun }> = [];
    const failed: unknown[] = [];
    const keep = vi.fn((profileId: string, run: LastRun) => {
      kept.push({ profileId, run });
    });
    const record = lastRunRecorder({ initial, keep, now: () => NOW, onError: (err) => failed.push(err) });
    return { record, keep, kept, failed };
  }

  it('keeps a run when it ends, following the states as they come', () => {
    const { record, kept } = recorder();
    record(state('starting'));
    record(state('starting', { pid: 123 }));
    record(state('running'));
    expect(kept).toEqual([]);
    record(state('stopping'));
    record(state('stopped'));
    expect(kept).toEqual([{ profileId: 'p1', run: { endedAt: NOW, how: 'stopped' } }]);
  });

  it('keeps each run as it ends, the crash of one and the stop of the next', () => {
    const { record, kept } = recorder();
    record(state('starting'));
    record(state('running'));
    record(state('crashed', { lastError: 'Appium exited with code 1' }));
    record(state('starting'));
    record(state('running'));
    record(state('stopped'));
    expect(kept.map((k) => k.run.how)).toEqual(['crashed', 'stopped']);
    expect(kept[0].run.reason).toBe('Appium exited with code 1');
  });

  it('keeps a crash once, when the process reports its exit after an error', () => {
    const { record, kept } = recorder();
    record(state('starting'));
    record(state('crashed', { lastError: 'spawn ENOENT' }));
    record(state('crashed', { lastError: 'Appium exited with code null' }));
    expect(kept).toHaveLength(1);
    expect(kept[0].run.reason).toBe('spawn ENOENT');
  });

  it('keeps nothing for a Start that failed before there was a run', () => {
    const { record, kept } = recorder();
    record(state('crashed', { profileId: null, lastError: 'Could not find the appium binary' }));
    expect(kept).toEqual([]);
  });

  it('starts from the state it was given: a run already under way when it began', () => {
    const { record, kept } = recorder(state('running'));
    record(state('stopped'));
    expect(kept).toHaveLength(1);
  });

  it('carries on when keeping fails, and says so', () => {
    const { record, keep, kept, failed } = recorder();
    keep.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    record(state('running'));
    expect(() => record(state('stopped'))).not.toThrow();
    expect(failed).toHaveLength(1);
    // The next run is still followed from the right state.
    record(state('running'));
    record(state('stopped'));
    expect(kept).toHaveLength(1);
  });
});

// The profile is already deleted when its last run is forgotten. A store that can't be written then
// must not fail the delete, or the window keeps showing a profile that is gone.
describe('forgetLastRun', () => {
  it('forgets the profile’s run', () => {
    const forget = vi.fn();
    const onError = vi.fn();
    forgetLastRun(forget, 'p1', onError);
    expect(forget).toHaveBeenCalledWith('p1');
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a store that fails, and does not throw', () => {
    const err = new Error('EACCES: permission denied');
    const onError = vi.fn();
    expect(() =>
      forgetLastRun(
        () => {
          throw err;
        },
        'p1',
        onError
      )
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith(err);
  });
});
