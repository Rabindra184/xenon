import { describe, expect, it } from 'vitest';
import {
  STATUS_HINT,
  STATUS_LABEL,
  isServerActive,
  startErrorToShow,
  statusBarLabel
} from '../src/renderer/src/serverStatus';

describe('statusBarLabel', () => {
  it('appends the hint while stopping', () => {
    expect(statusBarLabel('stopping')).toBe('Stopping — saving recordings and releasing phones…');
  });

  it('is just the label when the status has no hint', () => {
    expect(statusBarLabel('running')).toBe('Running');
    expect(statusBarLabel('starting')).toBe('Starting…');
  });

  it('keeps the sidebar label short', () => {
    expect(STATUS_LABEL.stopping).toBe('Stopping…');
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

  it('shows a failed start when nothing else on the bar says it', () => {
    expect(startErrorToShow(msg, { status: 'stopped', lastError: null })).toBe(msg);
  });

  it('shows nothing when there was no failed start', () => {
    expect(startErrorToShow(null, { status: 'stopped', lastError: null })).toBeNull();
    expect(startErrorToShow(null, { status: 'crashed', lastError: msg })).toBeNull();
  });

  // The supervisor records the failure as lastError and throws the same message,
  // so after a failed start the bar's crashed line already says it.
  it('shows it once when the crashed line carries the same message', () => {
    expect(startErrorToShow(msg, { status: 'crashed', lastError: msg })).toBeNull();
  });

  it('shows it when the crashed line carries something else', () => {
    expect(startErrorToShow(msg, { status: 'crashed', lastError: 'Appium exited with code 1' })).toBe(msg);
  });

  it('shows it when the server has no crash line to repeat it', () => {
    expect(startErrorToShow(msg, { status: 'stopped', lastError: msg })).toBe(msg);
  });

  it.each(['starting', 'running', 'stopping'] as const)('hides it while the server is %s', (status) => {
    expect(startErrorToShow(msg, { status, lastError: null })).toBeNull();
  });
});
