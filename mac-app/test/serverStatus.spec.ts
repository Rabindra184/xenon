import { describe, expect, it } from 'vitest';
import {
  STATUS_HINT,
  STATUS_LABEL,
  isServerActive,
  serverJustStopped,
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

describe('serverJustStopped', () => {
  it('is true when an active server ends, however it ended', () => {
    expect(serverJustStopped('stopping', 'stopped')).toBe(true);
    expect(serverJustStopped('running', 'crashed')).toBe(true);
    expect(serverJustStopped('starting', 'crashed')).toBe(true);
    expect(serverJustStopped('running', 'stopped')).toBe(true);
  });

  it('is false while it is still active, and when nothing was running', () => {
    expect(serverJustStopped('starting', 'running')).toBe(false);
    expect(serverJustStopped('running', 'stopping')).toBe(false);
    expect(serverJustStopped('stopped', 'starting')).toBe(false);
    expect(serverJustStopped('stopped', 'stopped')).toBe(false);
    expect(serverJustStopped('crashed', 'stopped')).toBe(false);
  });
});
