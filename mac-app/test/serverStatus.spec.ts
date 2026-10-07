import { describe, expect, it } from 'vitest';
import type { ServerStatus } from '../src/shared/types';
import { STATUS_HINT, STATUS_WORD, isServerActive, profileServerBadge, startErrorToShow } from '../src/renderer/src/serverStatus';

describe('STATUS_WORD', () => {
  it('names every server status in a word or two', () => {
    expect(STATUS_WORD).toEqual({
      stopped: 'Stopped',
      starting: 'Starting…',
      running: 'Running',
      stopping: 'Stopping…',
      crashed: 'Stopped unexpectedly'
    });
  });

  it('keeps the stopping hint for the longer line', () => {
    expect(STATUS_HINT.stopping).toBe('Saving recordings and releasing phones…');
  });
});

describe('isServerActive', () => {
  it('is true while the server is starting, running or stopping', () => {
    expect(isServerActive('starting')).toBe(true);
    expect(isServerActive('running')).toBe(true);
    expect(isServerActive('stopping')).toBe(true);
  });

  it('is false once it has stopped or crashed', () => {
    expect(isServerActive('stopped')).toBe(false);
    expect(isServerActive('crashed')).toBe(false);
  });
});

describe('startErrorToShow', () => {
  const msg = 'Could not find the appium binary.';
  const PLACES = ['home', 'setup', 'settings', 'logs'] as const;

  it.each(PLACES)('shows a failed start when nothing else says it, on %s', (place) => {
    expect(startErrorToShow(msg, { status: 'stopped', lastError: null }, place)).toBe(msg);
  });

  it.each(PLACES)('shows nothing when there was no failed start, on %s', (place) => {
    expect(startErrorToShow(null, { status: 'stopped', lastError: null }, place)).toBeNull();
    expect(startErrorToShow(null, { status: 'crashed', lastError: msg }, place)).toBeNull();
  });

  // The supervisor records the failure as lastError and throws the same message, so after a
  // failed start Home's "stopped unexpectedly" already tells it: the sidebar says it once.
  it('on Home, shows it once when the crashed line carries the same message', () => {
    expect(startErrorToShow(msg, { status: 'crashed', lastError: msg }, 'home')).toBeNull();
  });

  // Anywhere else Home is not on screen, and the error toast may have been dismissed: the
  // sidebar is then the only place that still says it.
  it.each(['setup', 'settings', 'logs'] as const)(
    'on %s, shows it even when the crashed line carries the same message',
    (place) => {
      expect(startErrorToShow(msg, { status: 'crashed', lastError: msg }, place)).toBe(msg);
    }
  );

  it.each(PLACES)('shows it when the crashed line carries something else, on %s', (place) => {
    expect(startErrorToShow(msg, { status: 'crashed', lastError: 'Appium exited with code 1' }, place)).toBe(msg);
  });

  it.each(PLACES)('shows it when the server has no crash line to repeat it, on %s', (place) => {
    expect(startErrorToShow(msg, { status: 'stopped', lastError: msg }, place)).toBe(msg);
  });

  it.each(['starting', 'running', 'stopping'] as const)('hides it while the server is %s, wherever', (status) => {
    for (const place of PLACES) expect(startErrorToShow(msg, { status, lastError: null }, place)).toBeNull();
  });
});

describe('profileServerBadge', () => {
  const state = (status: ServerStatus, profileId: string | null = 'a') => ({ status, profileId });

  it('marks the profile the server is running for, in the status word', () => {
    expect(profileServerBadge(state('running'), 'a')).toEqual({ word: 'Running', tone: 'ok' });
  });

  it('says Starting… and Stopping… while it gets there and back, never Running', () => {
    expect(profileServerBadge(state('starting'), 'a')).toEqual({ word: 'Starting…', tone: 'attention' });
    expect(profileServerBadge(state('stopping'), 'a')).toEqual({ word: 'Stopping…', tone: 'attention' });
  });

  it('marks no other profile', () => {
    for (const status of ['starting', 'running', 'stopping'] as const) {
      expect(profileServerBadge(state(status), 'b')).toBeNull();
    }
  });

  it('marks nothing once the server has stopped, expectedly or not', () => {
    expect(profileServerBadge(state('stopped'), 'a')).toBeNull();
    expect(profileServerBadge(state('crashed'), 'a')).toBeNull();
    expect(profileServerBadge(state('running', null), 'a')).toBeNull();
  });
});
