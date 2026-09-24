import { describe, it, expect } from 'vitest';
import { titleForPath } from './document-title';

describe('titleForPath', () => {
  it.each([
    ['/overview', 'Overview · Xenon'],
    ['/devices/live', 'Live devices · Xenon'],
    ['/builds', 'Sessions · Xenon'],
    ['/builds/abc123', 'Sessions · Xenon'],
    ['/builds/abc123/sessions/s-1', 'Session · Xenon'],
    ['/devices/381103b720057ece/control/logs', '381103b720057ece · Device · Xenon'],
    ['/runbooks/network', 'Runbook · network · Xenon'],
    ['/login', 'Sign in · Xenon'],
    ['/reset-password', 'Reset password · Xenon'],
    ['/settings/', 'Settings · Xenon'],
    ['/something-unknown', 'Xenon'],
  ])('%s → %s', (path, title) => {
    expect(titleForPath(path)).toBe(title);
  });
});
