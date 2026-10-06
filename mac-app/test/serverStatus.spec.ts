import { describe, expect, it } from 'vitest';
import { STATUS_HINT, STATUS_LABEL, statusBarLabel } from '../src/renderer/src/serverStatus';

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
