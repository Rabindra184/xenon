import { describe, expect, it } from 'vitest';
import {
  PLACES,
  TECHNICAL_PATHS,
  crashAlert,
  placeForMenuAction,
  setupNeedsAttention,
  showsTechnicalGroup
} from '../src/renderer/src/navigation';
import type { PreflightResult, ToolCheck } from '../src/shared/types';

const check = (over: Partial<ToolCheck> = {}): ToolCheck => ({
  id: 'node',
  label: 'Node.js',
  status: 'ok',
  detail: 'v22.12.0',
  blocking: true,
  ...over
});

const result = (over: Partial<PreflightResult> = {}): PreflightResult => ({
  ok: true,
  checks: [],
  blockers: [],
  ...over
});

describe('PLACES', () => {
  it('lists the four places in sidebar order', () => {
    expect(PLACES).toEqual(['home', 'setup', 'settings', 'logs']);
  });
});

describe('setupNeedsAttention', () => {
  it('is false before anything has been checked', () => {
    expect(setupNeedsAttention(null, false)).toBe(false);
  });

  it('is false when the check passed', () => {
    expect(setupNeedsAttention(result({ checks: [check()] }), false)).toBe(false);
  });

  it('is true when the check has a blocker', () => {
    expect(setupNeedsAttention(result({ ok: false, blockers: ['Port 4723 is in use'] }), false)).toBe(true);
  });

  it('is true when a blocking check is not ok', () => {
    expect(setupNeedsAttention(result({ ok: false, checks: [check({ status: 'missing' })] }), false)).toBe(true);
    expect(setupNeedsAttention(result({ ok: false, checks: [check({ status: 'warn' })] }), false)).toBe(true);
  });

  it('is false for a check that is not ok but does not block', () => {
    expect(setupNeedsAttention(result({ checks: [check({ status: 'warn', blocking: false })] }), false)).toBe(false);
  });

  it('is false while Set up runs, whatever the last check said', () => {
    expect(setupNeedsAttention(result({ ok: false, blockers: ['x'] }), true)).toBe(false);
    expect(setupNeedsAttention(result({ ok: false, checks: [check({ status: 'missing' })] }), true)).toBe(false);
  });
});

describe('crashAlert', () => {
  it('turns on when a running server stops unexpectedly', () => {
    expect(crashAlert({ status: 'running', alert: false }, { status: 'crashed', place: 'home' })).toBe(true);
  });

  it('turns on from starting and stopping too', () => {
    expect(crashAlert({ status: 'starting', alert: false }, { status: 'crashed', place: 'settings' })).toBe(true);
    expect(crashAlert({ status: 'stopping', alert: false }, { status: 'crashed', place: 'setup' })).toBe(true);
  });

  // The main process goes straight from stopped to crashed when a start fails before the server
  // runs (no Appium found), and starting→crashed can arrive in the same render as stopped.
  it('turns on when a stopped server goes straight to stopped unexpectedly', () => {
    expect(crashAlert({ status: 'stopped', alert: false }, { status: 'crashed', place: 'home' })).toBe(true);
  });

  it('does not come on again for a status that was already crashed', () => {
    expect(crashAlert({ status: 'crashed', alert: false }, { status: 'crashed', place: 'setup' })).toBe(false);
  });

  it('stays on while the person is elsewhere', () => {
    expect(crashAlert({ status: 'crashed', alert: true }, { status: 'crashed', place: 'settings' })).toBe(true);
    expect(crashAlert({ status: 'crashed', alert: true }, { status: 'crashed', place: 'home' })).toBe(true);
  });

  it('turns off once Logs is open', () => {
    expect(crashAlert({ status: 'crashed', alert: true }, { status: 'crashed', place: 'logs' })).toBe(false);
  });

  it('does not come on for a crash seen while Logs is open', () => {
    expect(crashAlert({ status: 'running', alert: false }, { status: 'crashed', place: 'logs' })).toBe(false);
  });

  it('stays off after Logs was seen and the person moves on', () => {
    expect(crashAlert({ status: 'crashed', alert: false }, { status: 'crashed', place: 'home' })).toBe(false);
  });

  it('does not come on for a normal stop', () => {
    expect(crashAlert({ status: 'stopping', alert: false }, { status: 'stopped', place: 'home' })).toBe(false);
  });

  it('keeps its value through a restart until Logs is opened', () => {
    expect(crashAlert({ status: 'crashed', alert: true }, { status: 'starting', place: 'home' })).toBe(true);
    expect(crashAlert({ status: 'starting', alert: true }, { status: 'running', place: 'home' })).toBe(true);
  });
});

describe('placeForMenuAction', () => {
  it('maps View’s four items to their places', () => {
    expect(placeForMenuAction('place-home')).toBe('home');
    expect(placeForMenuAction('place-setup')).toBe('setup');
    expect(placeForMenuAction('place-settings')).toBe('settings');
    expect(placeForMenuAction('place-logs')).toBe('logs');
  });

  it('is null for every other action', () => {
    for (const action of ['toggle-server', 'new-profile', 'launch-preview', 'export-config', 'manage-profiles'] as const) {
      expect(placeForMenuAction(action)).toBeNull();
    }
  });
});

describe('showsTechnicalGroup', () => {
  it('shows with technical details on', () => {
    expect(showsTechnicalGroup(true, [])).toBe(true);
  });

  it('hides with technical details off', () => {
    expect(showsTechnicalGroup(false, [])).toBe(false);
    expect(showsTechnicalGroup(false, ['server.port', 'maxSessions'])).toBe(false);
  });

  // An invalid base path (an imported profile, say) blocks Start; the field must be reachable to fix it.
  it('shows with technical details off when one of its fields has a problem', () => {
    expect(TECHNICAL_PATHS).toEqual(['server.basePath', 'server.appiumHome', 'server.keepAliveTimeout']);
    for (const path of TECHNICAL_PATHS) expect(showsTechnicalGroup(false, [path])).toBe(true);
  });
});
