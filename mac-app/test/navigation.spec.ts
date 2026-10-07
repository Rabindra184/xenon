import { describe, expect, it } from 'vitest';
import {
  PLACES,
  TECHNICAL_PATHS,
  crashAlert,
  hasTechnicalProblem,
  menuActionReady,
  placeForMenuAction,
  setupNeedsAttention,
  showsTechnicalGroup,
  technicalHold,
  type TechnicalHold
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

describe('hasTechnicalProblem', () => {
  it('is true when a setting of the Technical group has a problem', () => {
    expect(TECHNICAL_PATHS).toEqual(['server.basePath', 'server.appiumHome', 'server.keepAliveTimeout']);
    for (const path of TECHNICAL_PATHS) expect(hasTechnicalProblem([path])).toBe(true);
  });

  it('is false for problems elsewhere, or none', () => {
    expect(hasTechnicalProblem([])).toBe(false);
    expect(hasTechnicalProblem(['server.port', 'maxSessions'])).toBe(false);
  });
});

describe('showsTechnicalGroup and technicalHold', () => {
  const idle: TechnicalHold = { held: false, focused: false };
  /** Runs the events from `start` and says, after each, whether the group shows (technical details off). */
  const shows = (start: TechnicalHold, steps: Array<[Parameters<typeof technicalHold>[1], boolean]>) => {
    let hold = start;
    return steps.map(([event, problem]) => {
      hold = technicalHold(hold, event);
      return showsTechnicalGroup(false, problem, hold);
    });
  };

  it('shows with technical details on, whatever else', () => {
    expect(showsTechnicalGroup(true, false, idle)).toBe(true);
  });

  it('hides with technical details off and nothing wrong', () => {
    expect(showsTechnicalGroup(false, false, idle)).toBe(false);
  });

  // An invalid base path (an imported profile, say) blocks Start; the field must be reachable to fix it.
  it('shows with technical details off while one of its settings has a problem', () => {
    expect(showsTechnicalGroup(false, true, idle)).toBe(true);
  });

  // Typing "/wd/hub" over "wd/hub" fixes the problem at the "/": the group must not go then.
  it('stays while its setting is being fixed, and goes once focus leaves it fixed', () => {
    expect(
      shows(idle, [
        [{ type: 'problem', problem: true }, true],
        [{ type: 'focus' }, true],
        [{ type: 'problem', problem: false }, false],
        [{ type: 'blur', problem: false }, false]
      ])
    ).toEqual([true, true, true, false]);
  });

  it('stays when focus leaves it still wrong', () => {
    expect(
      shows(idle, [
        [{ type: 'problem', problem: true }, true],
        [{ type: 'focus' }, true],
        [{ type: 'blur', problem: true }, true]
      ])
    ).toEqual([true, true, true]);
    expect(technicalHold({ held: true, focused: true }, { type: 'blur', problem: true })).toEqual({
      held: true,
      focused: false
    });
  });

  // Turning technical details off (⌥⌘T) while typing in the group keeps it until focus leaves.
  it('never goes while one of its fields has focus', () => {
    const focused = technicalHold(idle, { type: 'focus' });
    expect(showsTechnicalGroup(false, false, focused)).toBe(true);
    expect(showsTechnicalGroup(false, false, technicalHold(focused, { type: 'blur', problem: false }))).toBe(false);
  });

  it('a problem going away is not, by itself, a reason to stop holding', () => {
    const held = technicalHold(idle, { type: 'problem', problem: true });
    expect(technicalHold(held, { type: 'problem', problem: false })).toEqual(held);
  });
});

describe('menuActionReady', () => {
  const loading = { profiles: false, settings: false };
  const profilesRead = { profiles: true, settings: false };
  const checked = { profiles: true, settings: true };

  // A Start, the launch preview and the config export all act on what a start would launch, so they
  // wait until the open profile's settings have been checked against its option list.
  it('holds what acts on the launch until the settings are checked', () => {
    for (const action of ['toggle-server', 'start-server', 'launch-preview', 'export-config'] as const) {
      expect(menuActionReady(action, loading)).toBe(false);
      expect(menuActionReady(action, profilesRead)).toBe(false);
      expect(menuActionReady(action, checked)).toBe(true);
    }
  });

  // The rest need only the profiles: an option list that is slow, or never comes, must not hold them.
  it('lets everything else act as soon as the profiles are read', () => {
    for (const action of [
      'new-profile',
      'import-profiles',
      'export-profile',
      'manage-profiles',
      'place-home',
      'place-setup',
      'place-settings',
      'place-logs'
    ] as const) {
      expect(menuActionReady(action, loading)).toBe(false);
      expect(menuActionReady(action, profilesRead)).toBe(true);
      expect(menuActionReady(action, checked)).toBe(true);
    }
  });
});
