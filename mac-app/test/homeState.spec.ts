import { describe, expect, it } from 'vitest';
import {
  crashReason,
  homeState,
  lastRunLine,
  needsSetup,
  readySummary,
  runningFor,
  type HomeInput
} from '../src/renderer/src/homeState';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
import { NOT_INSTALLED_MESSAGE, portInUseMessage } from '../src/shared/preflightMessages';
import type {
  LastRun,
  PreflightResult,
  Profile,
  ServerState,
  ServerStatus,
  ToolCheck,
  ValidationIssue
} from '../src/shared/types';

// Local time throughout, so the day words and clock times are the same in any zone.
const at = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m, d, h, min).getTime();
const NOW = at(2026, 9, 8, 12, 30);

const server = (status: ServerStatus, over: Partial<ServerState> = {}): ServerState => ({
  status,
  profileId: null,
  pid: null,
  port: null,
  dashboardUrl: null,
  startedAt: null,
  logFile: null,
  exitCode: null,
  exitSignal: null,
  lastError: null,
  ...over
});

const profile = (platform: unknown = 'both', over: { port?: number; hub?: unknown } = {}): Profile => {
  const p = makeDefaultProfile({ id: 'p1', now: 0, name: 'Local server' });
  const settings = { ...p.settings };
  if (platform === undefined) delete settings.platform;
  else settings.platform = platform;
  if (over.hub !== undefined) settings.hub = over.hub;
  return { ...p, settings, server: { ...p.server, port: over.port ?? 4723 } };
};

const check = (over: Partial<ToolCheck> = {}): ToolCheck => ({
  id: 'node',
  label: 'Node.js',
  status: 'ok',
  detail: 'v22.12.0',
  blocking: true,
  ...over
});

const NODE = check();
const APPIUM = check({ id: 'appium', label: 'Appium', detail: '3.1.0' });
const drivers = (found: string): ToolCheck =>
  check({ id: 'drivers', label: 'Appium drivers', detail: `installed: ${found}`, blocking: false });

const ready = (found = 'uiautomator2, xcuitest'): PreflightResult => ({
  ok: true,
  checks: [NODE, APPIUM, drivers(found)],
  blockers: []
});

const notReady = (over: Partial<PreflightResult> = {}): PreflightResult => ({
  ok: false,
  checks: [NODE, APPIUM, drivers('uiautomator2, xcuitest')],
  blockers: [],
  ...over
});

const issue: ValidationIssue = { path: 'server.port', label: 'Port', message: 'Must be 1-65535' };

const names: Record<string, string> = { p1: 'Local server', p2: 'Lab hub' };

const input = (over: Partial<HomeInput> = {}): HomeInput => ({
  server: server('stopped'),
  profile: profile(),
  profileName: (id) => names[id] ?? null,
  readiness: ready(),
  checking: false,
  installing: false,
  issues: [],
  lastRun: null,
  lastProblem: null,
  now: NOW,
  ...over
});

describe('homeState: each state', () => {
  it('1. another profile is running: says which, and offers to switch', () => {
    const view = homeState(input({ server: server('running', { profileId: 'p2', startedAt: NOW - 60_000 }) }));
    expect(view).toEqual({
      kind: 'other-running',
      title: '“Lab hub” is running',
      sentence: 'Only one profile runs at a time. Stop it to start this one.',
      primary: { id: 'switch-profile', label: 'Switch to it' }
    });
  });

  it('1. another profile’s server still starting or stopping is its server too', () => {
    for (const status of ['starting', 'stopping'] as const) {
      const view = homeState(input({ server: server(status, { profileId: 'p2' }) }));
      expect(view.kind).toBe('other-running');
      expect(view.title).toBe('“Lab hub” is running');
    }
  });

  it('1. a running profile that was removed: says so and offers no action (R23)', () => {
    const view = homeState(input({ server: server('running', { profileId: 'gone' }) }));
    expect(view).toEqual({
      kind: 'other-running',
      title: 'A removed profile is still running',
      sentence: 'Stop it to start this one.'
    });
    expect(view.primary).toBeUndefined();
  });

  it('1. an active server with no profile at all is treated as a removed profile', () => {
    const view = homeState(input({ server: server('running', { profileId: null }) }));
    expect(view.title).toBe('A removed profile is still running');
    expect(view.primary).toBeUndefined();
  });

  it('1. looks the name up by the server’s profile id', () => {
    const asked: string[] = [];
    homeState(
      input({
        server: server('running', { profileId: 'p2' }),
        profileName: (id) => {
          asked.push(id);
          return 'Lab hub';
        }
      })
    );
    expect(asked).toEqual(['p2']);
  });

  it('2. starting', () => {
    const view = homeState(input({ server: server('starting', { profileId: 'p1' }) }));
    expect(view).toEqual({
      kind: 'starting',
      title: 'Starting…',
      sentence: 'Usually under 10 seconds.',
      primary: { id: 'stop', label: 'Stop' }
    });
  });

  it('3. running: how long, Open dashboard, Stop', () => {
    const view = homeState(input({ server: server('running', { profileId: 'p1', startedAt: NOW - 300_000 }) }));
    expect(view).toEqual({
      kind: 'running',
      title: 'Running',
      sentence: 'for 5 min',
      primary: { id: 'open-dashboard', label: 'Open dashboard' },
      secondary: { id: 'stop', label: 'Stop' }
    });
  });

  it('3. running with no start time yet says under a minute', () => {
    const view = homeState(input({ server: server('running', { profileId: 'p1', startedAt: null }) }));
    expect(view.sentence).toBe('for under a minute');
  });

  it('4. stopping has no buttons', () => {
    const view = homeState(input({ server: server('stopping', { profileId: 'p1' }) }));
    expect(view).toEqual({
      kind: 'stopping',
      title: 'Stopping — saving recordings and releasing phones…'
    });
  });

  it('5. setting up', () => {
    const view = homeState(input({ installing: true }));
    expect(view).toEqual({ kind: 'setting-up', title: 'Setting up this Mac…' });
  });

  it('6. crashed: the reason, the last message, Start again and See what happened', () => {
    const view = homeState(
      input({
        server: server('crashed', { profileId: 'p1', lastError: 'Appium exited with code 1' }),
        lastProblem: 'Error: something broke'
      })
    );
    expect(view).toEqual({
      kind: 'crashed',
      title: 'Xenon stopped unexpectedly',
      sentence: 'Appium closed on its own.',
      detail: 'Last message: “Error: something broke”',
      primary: { id: 'start', label: 'Start again' },
      secondary: { id: 'see-logs', label: 'See what happened' }
    });
  });

  it('6. a crash with no last message has no detail', () => {
    const view = homeState(input({ server: server('crashed', { profileId: 'p1' }), lastProblem: null }));
    expect(view.kind).toBe('crashed');
    expect(view.sentence).toBe('Appium closed on its own.');
    expect('detail' in view).toBe(false);
  });

  it('6. a crash with a blank last message has no detail', () => {
    const view = homeState(input({ server: server('crashed', { profileId: 'p1' }), lastProblem: '   ' }));
    expect('detail' in view).toBe(false);
  });

  it('6. a crash with no profile id is this profile’s', () => {
    const view = homeState(input({ server: server('crashed', { profileId: null }) }));
    expect(view.kind).toBe('crashed');
  });

  it('6. a crash for a port in use says so, using this profile’s port', () => {
    const view = homeState(
      input({
        server: server('crashed', { profileId: 'p1' }),
        profile: profile('both', { port: 4800 }),
        lastProblem: 'Error: listen EADDRINUSE: address already in use :::4800'
      })
    );
    expect(view.sentence).toBe('Port 4800 was taken by another app.');
  });

  it('6. keeps the last message to a line of 120 characters or fewer, ending in …', () => {
    const exactly = 'a'.repeat(120);
    expect(homeState(input({ server: server('crashed'), lastProblem: exactly })).detail).toBe(
      `Last message: “${exactly}”`
    );
    const tooLong = 'b'.repeat(121);
    const shown = homeState(input({ server: server('crashed'), lastProblem: tooLong })).detail ?? '';
    expect(shown).toBe(`Last message: “${'b'.repeat(119)}…”`);
  });

  it('6. shows the last message on one line', () => {
    const view = homeState(input({ server: server('crashed'), lastProblem: 'first line\n  second line' }));
    expect(view.detail).toBe('Last message: “first line second line”');
  });

  it('6. a crash that belongs to another profile is not this profile’s', () => {
    const view = homeState(input({ server: server('crashed', { profileId: 'p2' }) }));
    expect(view.kind).toBe('ready');
  });

  it('7. first run: the checklist and Set up this Mac', () => {
    const view = homeState(
      input({
        readiness: notReady({
          blockers: [NOT_INSTALLED_MESSAGE],
          checks: [NODE, APPIUM, drivers('none')]
        })
      })
    );
    expect(view).toEqual({
      kind: 'first-run',
      title: 'Let’s get this Mac ready',
      sentence: 'A one-time setup, about 2 minutes.',
      primary: { id: 'setup', label: 'Set up this Mac' },
      checklist: [
        { label: 'Node.js', done: true },
        { label: 'Appium', done: true },
        { label: 'Xenon', done: false },
        { label: 'Android support', done: false },
        { label: 'iPhone support', done: false }
      ]
    });
  });

  it('7. first run for a missing driver, with Xenon installed', () => {
    const view = homeState(input({ readiness: ready('uiautomator2') }));
    expect(view.kind).toBe('first-run');
    expect(view.checklist).toEqual([
      { label: 'Node.js', done: true },
      { label: 'Appium', done: true },
      { label: 'Xenon', done: true },
      { label: 'Android support', done: true },
      { label: 'iPhone support', done: false }
    ]);
  });

  it('7. the checklist lists only the phones the profile uses', () => {
    const missing = notReady({ blockers: [NOT_INSTALLED_MESSAGE], checks: [NODE, APPIUM, drivers('xcuitest')] });
    const android = homeState(input({ profile: profile('android'), readiness: missing }));
    expect(android.checklist?.map((i) => i.label)).toEqual(['Node.js', 'Appium', 'Xenon', 'Android support']);
    expect(android.checklist?.find((i) => i.label === 'Android support')?.done).toBe(false);
    const ios = homeState(input({ profile: profile('ios'), readiness: missing }));
    expect(ios.checklist?.map((i) => i.label)).toEqual(['Node.js', 'Appium', 'Xenon', 'iPhone support']);
    expect(ios.checklist?.find((i) => i.label === 'iPhone support')?.done).toBe(true);
  });

  it('7. a profile with no platform uses both phones', () => {
    const view = homeState(
      input({ profile: profile(undefined), readiness: notReady({ blockers: [NOT_INSTALLED_MESSAGE] }) })
    );
    expect(view.checklist?.map((i) => i.label)).toEqual([
      'Node.js',
      'Appium',
      'Xenon',
      'Android support',
      'iPhone support'
    ]);
  });

  it('8. can’t start: a port in use, with no free port known', () => {
    const view = homeState(input({ readiness: notReady({ blockers: [portInUseMessage(4723)] }) }));
    expect(view).toEqual({
      kind: 'cant-start',
      title: 'Can’t start yet',
      sentence: portInUseMessage(4723),
      primary: { id: 'quick-fix', label: 'See Setup' },
      secondary: { id: 'try-again', label: 'Try again' },
      footer: 'Something else? See Setup for every check.',
      blocker: { kind: 'port-in-use', port: 4723 }
    });
  });

  it('8. can’t start: a port in use, offering the next free port', () => {
    const view = homeState(input({ readiness: notReady({ blockers: [portInUseMessage(4723)] }), freePort: 4724 }));
    expect(view.primary).toEqual({ id: 'quick-fix', label: 'Use port 4724' });
  });

  it('8. can’t start: an invalid setting', () => {
    const view = homeState(input({ issues: [issue, { ...issue, path: 'server.basePath', label: 'Base path' }] }));
    expect(view).toEqual({
      kind: 'cant-start',
      title: 'Can’t start yet',
      sentence: 'Fix 2 settings first: Port',
      primary: { id: 'quick-fix', label: 'Fix it' },
      secondary: { id: 'try-again', label: 'Try again' },
      footer: 'Something else? See Setup for every check.',
      blocker: { kind: 'invalid', issue, count: 2 }
    });
  });

  it('8. can’t start: Node.js missing', () => {
    const view = homeState(
      input({
        readiness: notReady({
          checks: [check({ status: 'missing', remediation: 'Install Node.js.' }), APPIUM, drivers('none')]
        })
      })
    );
    expect(view.kind).toBe('cant-start');
    expect(view.sentence).toBe('Install Node.js.');
    expect(view.primary).toEqual({ id: 'quick-fix', label: 'How to install' });
    expect(view.blocker).toEqual({ kind: 'runtime', check: 'node' });
  });

  it('8. can’t start: anything else', () => {
    const view = homeState(input({ readiness: notReady({ blockers: ['Something odd happened.'] }) }));
    expect(view.kind).toBe('cant-start');
    expect(view.sentence).toBe('Something odd happened.');
    expect(view.primary).toEqual({ id: 'quick-fix', label: 'See Setup' });
    expect(view.blocker).toEqual({ kind: 'other', reason: 'Something odd happened.' });
  });

  it('8. can’t start after a crash of another profile', () => {
    const view = homeState(
      input({
        server: server('crashed', { profileId: 'p2' }),
        readiness: notReady({ blockers: ['Something odd happened.'] })
      })
    );
    expect(view.kind).toBe('cant-start');
  });

  it('9. checking, before there is any answer', () => {
    const view = homeState(input({ readiness: null, checking: true }));
    expect(view).toEqual({ kind: 'checking', title: 'Checking this Mac…' });
  });

  it('9. checking, when no check has started yet', () => {
    expect(homeState(input({ readiness: null, checking: false })).kind).toBe('checking');
  });

  it('10. ready: the summary and no footer before any run', () => {
    const view = homeState(input({ profile: profile('android') }));
    expect(view).toEqual({
      kind: 'ready',
      title: 'Ready to start',
      sentence: 'Android phones · this Mac only',
      primary: { id: 'start', label: 'Start' }
    });
  });

  it('10. ready: the footer says how the last run ended', () => {
    const lastRun: LastRun = { endedAt: at(2026, 9, 8, 9, 42), how: 'stopped' };
    const view = homeState(input({ lastRun }));
    expect(view.footer).toBe('Last run: today 09:42 · stopped normally');
    expect(view.sentence).toBe('Android phones and iPhones · this Mac only');
  });

  it('10. ready, while a re-check is in flight, keeps the last answer', () => {
    expect(homeState(input({ checking: true })).kind).toBe('ready');
  });
});

describe('homeState: which state wins', () => {
  const firstRun = notReady({ blockers: [NOT_INSTALLED_MESSAGE], checks: [NODE, APPIUM, drivers('none')] });

  it('another profile running beats everything', () => {
    for (const status of ['starting', 'running', 'stopping'] as const) {
      const view = homeState(
        input({
          server: server(status, { profileId: 'p2' }),
          installing: true,
          issues: [issue],
          readiness: firstRun,
          lastProblem: 'Error: x'
        })
      );
      expect(view.kind).toBe('other-running');
    }
  });

  it('this profile’s server being active beats Set up running', () => {
    expect(homeState(input({ server: server('starting', { profileId: 'p1' }), installing: true })).kind).toBe(
      'starting'
    );
    expect(homeState(input({ server: server('running', { profileId: 'p1' }), installing: true })).kind).toBe(
      'running'
    );
    expect(homeState(input({ server: server('stopping', { profileId: 'p1' }), installing: true })).kind).toBe(
      'stopping'
    );
  });

  it('this profile’s server being active beats a failed check', () => {
    const view = homeState(input({ server: server('running', { profileId: 'p1' }), readiness: firstRun, issues: [issue] }));
    expect(view.kind).toBe('running');
  });

  it('Set up running beats a crash', () => {
    const view = homeState(input({ server: server('crashed', { profileId: 'p1' }), installing: true }));
    expect(view.kind).toBe('setting-up');
  });

  it('Set up running beats first run, can’t start and ready', () => {
    expect(homeState(input({ installing: true, readiness: firstRun })).kind).toBe('setting-up');
    expect(homeState(input({ installing: true, issues: [issue] })).kind).toBe('setting-up');
    expect(homeState(input({ installing: true })).kind).toBe('setting-up');
    expect(homeState(input({ installing: true, readiness: null, checking: true })).kind).toBe('setting-up');
  });

  it('a crash beats first run', () => {
    const view = homeState(input({ server: server('crashed', { profileId: 'p1' }), readiness: firstRun }));
    expect(view.kind).toBe('crashed');
  });

  it('a crash beats can’t start', () => {
    const view = homeState(
      input({ server: server('crashed', { profileId: 'p1' }), readiness: notReady({ blockers: ['x'] }), issues: [issue] })
    );
    expect(view.kind).toBe('crashed');
  });

  it('first run beats can’t start', () => {
    const view = homeState(input({ readiness: firstRun, issues: [issue] }));
    expect(view.kind).toBe('first-run');
  });

  it('first run beats a port in use', () => {
    const both = notReady({ blockers: [portInUseMessage(4723), NOT_INSTALLED_MESSAGE] });
    expect(homeState(input({ readiness: both })).kind).toBe('first-run');
  });

  it('can’t start beats checking: an invalid setting is known before the first check ends', () => {
    expect(homeState(input({ readiness: null, checking: true, issues: [issue] })).kind).toBe('cant-start');
  });

  it('can’t start beats ready', () => {
    expect(homeState(input({ issues: [issue] })).kind).toBe('cant-start');
  });
});

describe('needsSetup', () => {
  it('is false before there is any answer', () => {
    expect(needsSetup(null, profile())).toBe(false);
  });

  it('is true when Xenon is not installed in the Appium folder', () => {
    expect(needsSetup(notReady({ blockers: [NOT_INSTALLED_MESSAGE] }), profile())).toBe(true);
  });

  it('is false when everything is installed', () => {
    expect(needsSetup(ready(), profile())).toBe(false);
  });

  it('is true when a profile for both phones lacks the iPhone driver', () => {
    expect(needsSetup(ready('uiautomator2'), profile('both'))).toBe(true);
  });

  it('is true when a profile for both phones lacks the Android driver', () => {
    expect(needsSetup(ready('xcuitest'), profile('both'))).toBe(true);
  });

  it('is true for a profile with no platform that lacks a driver', () => {
    expect(needsSetup(ready('uiautomator2'), profile(undefined))).toBe(true);
  });

  it('is false for an Android-only profile that lacks only the iPhone driver', () => {
    expect(needsSetup(ready('uiautomator2'), profile('android'))).toBe(false);
  });

  it('is false for an iPhone-only profile that lacks only the Android driver', () => {
    expect(needsSetup(ready('xcuitest'), profile('ios'))).toBe(false);
  });

  it('is true for an Android-only profile that lacks the Android driver', () => {
    expect(needsSetup(ready('xcuitest'), profile('android'))).toBe(true);
    expect(needsSetup(ready('none'), profile('android'))).toBe(true);
  });

  it('is true for an iPhone-only profile that lacks the iPhone driver', () => {
    expect(needsSetup(ready('uiautomator2'), profile('ios'))).toBe(true);
  });

  it('leaves drivers alone while Node.js or Appium is not ok, since Setup cannot be the first thing to say', () => {
    const noNode: PreflightResult = {
      ok: false,
      checks: [check({ status: 'missing' }), APPIUM, drivers('none')],
      blockers: []
    };
    const noAppium: PreflightResult = {
      ok: false,
      checks: [NODE, check({ ...APPIUM, status: 'warn' }), drivers('none')],
      blockers: []
    };
    expect(needsSetup(noNode, profile())).toBe(false);
    expect(needsSetup(noAppium, profile())).toBe(false);
  });

  it('is false when the check did not report on drivers at all', () => {
    expect(needsSetup({ ok: true, checks: [NODE, APPIUM], blockers: [] }, profile())).toBe(false);
  });
});

describe('runningFor', () => {
  it('says under a minute for less than a minute', () => {
    expect(runningFor(0)).toBe('for under a minute');
    expect(runningFor(59_000)).toBe('for under a minute');
    expect(runningFor(59_999)).toBe('for under a minute');
  });

  it('says minutes up to an hour', () => {
    expect(runningFor(60_000)).toBe('for 1 min');
    expect(runningFor(300_000)).toBe('for 5 min');
    expect(runningFor(3_599_000)).toBe('for 59 min');
  });

  it('says hours and minutes', () => {
    expect(runningFor(4_320_000)).toBe('for 1 h 12 min');
    expect(runningFor(3_600_000 * 5 + 60_000)).toBe('for 5 h 1 min');
  });

  it('leaves out the minutes on the hour', () => {
    expect(runningFor(3_600_000)).toBe('for 1 h');
    expect(runningFor(7_200_000)).toBe('for 2 h');
  });

  it('never goes negative', () => {
    expect(runningFor(-5_000)).toBe('for under a minute');
    expect(runningFor(Number.NaN)).toBe('for under a minute');
  });
});

describe('readySummary', () => {
  it('names the phones: both, Android, iPhone', () => {
    expect(readySummary(profile('both'))).toBe('Android phones and iPhones · this Mac only');
    expect(readySummary(profile(undefined))).toBe('Android phones and iPhones · this Mac only');
    expect(readySummary(profile('android'))).toBe('Android phones · this Mac only');
    expect(readySummary(profile('ios'))).toBe('iPhones · this Mac only');
  });

  it('treats an unknown platform as both, as Xenon does', () => {
    expect(readySummary(profile('toString'))).toBe('Android phones and iPhones · this Mac only');
    expect(readySummary(profile(42))).toBe('Android phones and iPhones · this Mac only');
  });

  it('says the hub’s name when this Mac is shared with a hub', () => {
    expect(readySummary(profile('android', { hub: 'http://hub-mac:4723' }))).toBe(
      'Android phones · shared with hub-mac'
    );
    expect(readySummary(profile('both', { hub: 'https://Lab-Hub.example.com/' }))).toBe(
      'Android phones and iPhones · shared with lab-hub.example.com'
    );
  });

  it('reads an address typed without its scheme', () => {
    expect(readySummary(profile('ios', { hub: 'hub-mac:4723' }))).toBe('iPhones · shared with hub-mac');
  });

  it('is this Mac only when the hub is empty or not text', () => {
    expect(readySummary(profile('ios', { hub: '' }))).toBe('iPhones · this Mac only');
    expect(readySummary(profile('ios', { hub: '   ' }))).toBe('iPhones · this Mac only');
    expect(readySummary(profile('ios', { hub: 7 }))).toBe('iPhones · this Mac only');
  });
});

describe('lastRunLine', () => {
  it('is null when there has been no run', () => {
    expect(lastRunLine(null, NOW)).toBeNull();
  });

  it('says today, with the time', () => {
    expect(lastRunLine({ endedAt: at(2026, 9, 8, 9, 42), how: 'stopped' }, NOW)).toBe(
      'Last run: today 09:42 · stopped normally'
    );
  });

  it('says yesterday, and how a crash ended', () => {
    expect(lastRunLine({ endedAt: at(2026, 9, 7, 23, 5), how: 'crashed' }, NOW)).toBe(
      'Last run: yesterday 23:05 · stopped unexpectedly'
    );
  });

  it('says the day and month for anything older, with no zero in front of the day', () => {
    expect(lastRunLine({ endedAt: at(2026, 9, 3, 7, 5), how: 'stopped' }, NOW)).toBe(
      'Last run: 3 Oct 07:05 · stopped normally'
    );
    expect(lastRunLine({ endedAt: at(2026, 9, 6, 18, 0), how: 'stopped' }, NOW)).toBe(
      'Last run: 6 Oct 18:00 · stopped normally'
    );
  });

  it('counts calendar days, not 24-hour spans', () => {
    const justAfterMidnight = at(2026, 9, 8, 0, 5);
    expect(lastRunLine({ endedAt: at(2026, 9, 7, 23, 55), how: 'stopped' }, justAfterMidnight)).toBe(
      'Last run: yesterday 23:55 · stopped normally'
    );
    expect(lastRunLine({ endedAt: at(2026, 9, 7, 0, 5), how: 'stopped' }, at(2026, 9, 8, 23, 55))).toBe(
      'Last run: yesterday 00:05 · stopped normally'
    );
    expect(lastRunLine({ endedAt: at(2026, 9, 6, 23, 55), how: 'stopped' }, justAfterMidnight)).toBe(
      'Last run: 6 Oct 23:55 · stopped normally'
    );
  });

  it('finds yesterday across a month and a year', () => {
    expect(lastRunLine({ endedAt: at(2026, 9, 31, 20, 0), how: 'stopped' }, at(2026, 10, 1, 8, 0))).toBe(
      'Last run: yesterday 20:00 · stopped normally'
    );
    expect(lastRunLine({ endedAt: at(2026, 11, 31, 22, 0), how: 'stopped' }, at(2027, 0, 1, 8, 0))).toBe(
      'Last run: yesterday 22:00 · stopped normally'
    );
    expect(lastRunLine({ endedAt: at(2026, 1, 28, 22, 0), how: 'stopped' }, at(2026, 2, 1, 8, 0))).toBe(
      'Last run: yesterday 22:00 · stopped normally'
    );
  });

  it('does not take the same day of another month or year for today', () => {
    expect(lastRunLine({ endedAt: at(2026, 8, 8, 9, 42), how: 'stopped' }, NOW)).toBe(
      'Last run: 8 Sep 09:42 · stopped normally'
    );
    expect(lastRunLine({ endedAt: at(2025, 9, 8, 9, 42), how: 'stopped' }, NOW)).toBe(
      'Last run: 8 Oct 09:42 · stopped normally'
    );
  });

  it('uses the same English month names every time', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((name, i) => {
      expect(lastRunLine({ endedAt: at(2025, i, 15, 10, 0), how: 'stopped' }, at(2026, 5, 1))).toBe(
        `Last run: 15 ${name} 10:00 · stopped normally`
      );
    });
  });

  it('writes the time with two digits each', () => {
    expect(lastRunLine({ endedAt: at(2026, 9, 8, 0, 0), how: 'stopped' }, NOW)).toBe(
      'Last run: today 00:00 · stopped normally'
    );
  });
});

describe('crashReason', () => {
  const s = (lastError: string | null = null) => server('crashed', { lastError });

  it('names a port taken by another app, with the profile’s port', () => {
    expect(crashReason(s(), 'Error: listen EADDRINUSE: address already in use :::4723', 4723)).toBe(
      'Port 4723 was taken by another app.'
    );
    expect(crashReason(s(), 'Address Already In Use', 4800)).toBe('Port 4800 was taken by another app.');
    expect(crashReason(s(), 'EADDRINUSE', 4800)).toBe('Port 4800 was taken by another app.');
  });

  it('says Appium refused the settings', () => {
    for (const line of [
      'error: unknown option: --foo',
      'Unknown option',
      '"--port" is not a valid value',
      'Invalid argument for the plugin',
      'invalid plugin arg: maxSessions',
      'Invalid option',
      'invalid plugin option',
      'Invalid config'
    ]) {
      expect(crashReason(s(), line, 4723)).toBe('Appium refused this profile’s settings.');
    }
  });

  it('says Appium closed on its own for anything else', () => {
    expect(crashReason(s(), 'Appium exited with code SIGKILL', 4723)).toBe('Appium closed on its own.');
    expect(crashReason(s(), 'Appium exited with code 1', 4723)).toBe('Appium closed on its own.');
  });

  it('reads the server’s last error when there is no last message', () => {
    expect(crashReason(s('Error: listen EADDRINUSE :::4723'), null, 4723)).toBe('Port 4723 was taken by another app.');
    expect(crashReason(s('Appium exited with code 1'), null, 4723)).toBe('Appium closed on its own.');
  });

  it('prefers the last message to the server’s last error', () => {
    expect(crashReason(s('Error: listen EADDRINUSE :::4723'), 'Appium exited with code 1', 4723)).toBe(
      'Appium closed on its own.'
    );
  });

  it('treats a blank last message as none', () => {
    expect(crashReason(s('EADDRINUSE'), '  ', 4723)).toBe('Port 4723 was taken by another app.');
  });

  it('says Appium closed on its own when there is nothing at all', () => {
    expect(crashReason(s(null), null, 4723)).toBe('Appium closed on its own.');
  });
});
