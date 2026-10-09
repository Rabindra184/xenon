import { describe, expect, it } from 'vitest';
import {
  PLACES,
  TECHNICAL_PATHS,
  crashAlert,
  crashAlertAtOpen,
  hasTechnicalProblem,
  menuActionReady,
  placeAfterFailedCheck,
  placeForMenuAction,
  setupNeedsAttention,
  showsTechnicalGroup,
  technicalFieldsShown,
  technicalHold,
  type TechnicalHold
} from '../src/renderer/src/navigation';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
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

describe('setupNeedsAttention: any Setup row that needs attention', () => {
  const tool = (id: string, over: Partial<ToolCheck> = {}): ToolCheck => ({
    id,
    label: id,
    status: 'ok',
    code: 'ok',
    detail: `${id} detail`,
    blocking: false,
    ...over
  });
  const ADB_MISSING = tool('adb', {
    status: 'warn',
    code: 'missing',
    detail: 'adb not found and no Android SDK detected',
    remediation: 'Only needed for local Android devices.'
  });
  const XCODE_MISSING = tool('xcode', { status: 'warn', code: 'missing', detail: 'xcodebuild not found' });
  /** Every check passing, with `over` in place of the check of the same id. */
  const fine = (...over: ToolCheck[]): PreflightResult => {
    const base = [
      tool('node'),
      tool('appium'),
      tool('drivers', { detail: 'installed: uiautomator2, xcuitest' }),
      tool('adb'),
      tool('xcode'),
      tool('go-ios')
    ];
    return { ok: true, checks: base.map((c) => over.find((o) => o.id === c.id) ?? c), blockers: [] };
  };
  const profileFor = (platform: string) => {
    const p = makeDefaultProfile({ id: 'p1', now: 0 });
    return { ...p, settings: { ...p.settings, platform } };
  };

  it('is false for an iPhone-only profile on a Mac with no Android tools (they are not its row)', () => {
    expect(setupNeedsAttention(fine(ADB_MISSING), false, profileFor('ios'), '2.17.0')).toBe(false);
  });

  it('is true for an Android profile on a Mac with no Android tools, which is not a blocker', () => {
    const r = fine(ADB_MISSING);
    expect(r.ok).toBe(true);
    expect(setupNeedsAttention(r, false, profileFor('android'), '2.17.0')).toBe(true);
  });

  it('is true for a profile for both kinds of phone with no Xcode, and not for an Android one', () => {
    expect(setupNeedsAttention(fine(XCODE_MISSING), false, profileFor('both'), '2.17.0')).toBe(true);
    expect(setupNeedsAttention(fine(XCODE_MISSING), false, profileFor('android'), '2.17.0')).toBe(false);
  });

  it('is true when Xenon is not installed, and not while its version is still being read', () => {
    expect(setupNeedsAttention(fine(), false, profileFor('both'), null)).toBe(true);
    expect(setupNeedsAttention(fine(), false, profileFor('both'), undefined)).toBe(false);
  });

  it('is true when a driver the profile uses is missing', () => {
    const noU2 = fine(tool('drivers', { detail: 'installed: xcuitest' }));
    expect(setupNeedsAttention(noU2, false, profileFor('android'), '2.17.0')).toBe(true);
    expect(setupNeedsAttention(noU2, false, profileFor('ios'), '2.17.0')).toBe(false);
  });

  it('is false on a Mac where every row is fine', () => {
    expect(setupNeedsAttention(fine(), false, profileFor('both'), '2.17.0')).toBe(false);
  });

  it('still counts a blocker with no row of its own (the port)', () => {
    const taken = { ...fine(), ok: false, blockers: ['Port 4723 is already in use by another app.'] };
    expect(setupNeedsAttention(taken, false, profileFor('ios'), '2.17.0')).toBe(true);
  });

  it('is false while Set up runs, rows needing attention or not', () => {
    expect(setupNeedsAttention(fine(ADB_MISSING), true, profileFor('android'), null)).toBe(false);
  });

  it('is false before anything has been checked, whatever the profile', () => {
    expect(setupNeedsAttention(null, false, profileFor('android'), null)).toBe(false);
  });

  describe('an answer made for another Appium folder', () => {
    const NOT_INSTALLED = "Run Set up first. Xenon isn't installed in the Appium folder this profile uses.";
    const at = (appiumHome: string) => {
      const p = profileFor('android');
      return { ...p, server: { ...p.server, appiumHome } };
    };
    const forFolder = (appiumHome: string) => ({ appiumHome, port: 4723 });
    const emptyAnswer = { ...fine(tool('drivers', { detail: 'installed: none' })), ok: false, blockers: [NOT_INSTALLED] };

    it('leaves out “Run Set up first” and the folder’s rows until the folder’s own answer is back', () => {
      // The answer is the empty folder's; the profile now names a set-up one.
      expect(setupNeedsAttention(emptyAnswer, false, at('/set'), '2.17.0', forFolder('/empty'))).toBe(false);
    });

    it('counts them once the answer is for the profile’s folder', () => {
      expect(setupNeedsAttention(emptyAnswer, false, at('/empty'), null, forFolder('/empty'))).toBe(true);
    });

    it('still counts what doesn’t depend on the folder (This Mac, another blocker)', () => {
      expect(setupNeedsAttention(fine(ADB_MISSING), false, at('/set'), '2.17.0', forFolder('/empty'))).toBe(true);
      const port = { ...emptyAnswer, blockers: ['Port 4723 is already in use by another app.', NOT_INSTALLED] };
      expect(setupNeedsAttention(port, false, at('/set'), '2.17.0', forFolder('/empty'))).toBe(true);
    });

    it('takes an answer it can’t place as the profile’s own', () => {
      expect(setupNeedsAttention(emptyAnswer, false, at('/set'), '2.17.0', null)).toBe(true);
    });
  });
});

// R67: a window opened after a crash (the app was in the menu bar with its window closed) never
// saw the status change, so its first read of the status decides the dot.
describe('crashAlertAtOpen', () => {
  it('is on when the window’s first read says the server stopped unexpectedly', () => {
    expect(crashAlertAtOpen('crashed', 'home')).toBe(true);
    expect(crashAlertAtOpen('crashed', 'settings')).toBe(true);
  });

  it('is off when the window opens on Logs, as opening Logs clears it', () => {
    expect(crashAlertAtOpen('crashed', 'logs')).toBe(false);
  });

  it('is off for any other status', () => {
    for (const status of ['stopped', 'starting', 'running', 'stopping'] as const) {
      expect(crashAlertAtOpen(status, 'home'), status).toBe(false);
    }
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

// A start whose own check found a problem shows where the problem is told. Home tells it and
// offers the fix, so from Home it stays; from anywhere else Setup opens, as in Part A.
describe('placeAfterFailedCheck', () => {
  it('stays on Home, which says what is in the way and offers its fix', () => {
    expect(placeAfterFailedCheck('home')).toBeNull();
  });

  it('opens Setup from every other place', () => {
    for (const place of ['setup', 'settings', 'logs'] as const) {
      expect(placeAfterFailedCheck(place)).toBe('setup');
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

describe('technicalFieldsShown', () => {
  it('is every field of the group with technical details on', () => {
    expect(technicalFieldsShown(true, new Set())).toEqual([...TECHNICAL_PATHS]);
    expect(technicalFieldsShown(true, new Set(['server.basePath']))).toEqual([...TECHNICAL_PATHS]);
  });

  // R52: the group is only there for a problem, so it shows the setting to fix and no folder, command or path.
  it('is only the fields that have had a problem, with technical details off', () => {
    expect(technicalFieldsShown(false, new Set(['server.basePath']))).toEqual(['server.basePath']);
    expect(technicalFieldsShown(false, new Set(['server.keepAliveTimeout', 'server.basePath']))).toEqual([
      'server.basePath',
      'server.keepAliveTimeout'
    ]);
  });

  it('ignores problems with settings outside the group', () => {
    expect(technicalFieldsShown(false, new Set(['server.port', 'maxSessions']))).toEqual([]);
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
  const loading = { profiles: false, server: false, settings: false };
  const profilesRead = { profiles: true, server: false, settings: false };
  const serverRead = { profiles: true, server: true, settings: false };
  const checked = { profiles: true, server: true, settings: true };

  // A Start, the launch preview and the config export all act on what a start would launch, so they
  // wait until the open profile's settings have been checked against its option list.
  it('holds what acts on the launch until the settings are checked', () => {
    for (const action of ['toggle-server', 'start-server', 'launch-preview', 'export-config'] as const) {
      expect(menuActionReady(action, loading)).toBe(false);
      expect(menuActionReady(action, profilesRead)).toBe(false);
      expect(menuActionReady(action, serverRead)).toBe(false);
      expect(menuActionReady(action, checked)).toBe(true);
    }
  });

  // Copy Test Address copies the running profile's address while a server is active, which may not
  // be the open profile: it waits until the window knows the server's status, not for the settings.
  it('holds Copy Test Address until the server’s status is read', () => {
    expect(menuActionReady('copy-test-address', loading)).toBe(false);
    expect(menuActionReady('copy-test-address', profilesRead)).toBe(false);
    expect(menuActionReady('copy-test-address', serverRead)).toBe(true);
    expect(menuActionReady('copy-test-address', checked)).toBe(true);
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
      expect(menuActionReady(action, serverRead)).toBe(true);
      expect(menuActionReady(action, checked)).toBe(true);
    }
  });
});
