import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_FAILED,
  ReadinessTracker,
  blockedReason,
  blockerLines,
  decideStart,
  firstBlocker,
  planRecheck,
  recheckKey,
  runCheck,
  startFailureMessage,
  type RecheckKey,
  type StartDecision
} from '../src/renderer/src/readiness';
import { ToolchainInspector } from '../src/main/ToolchainInspector';
import type { PreflightResult, Profile, ToolCheck, ValidationIssue } from '../src/shared/types';

// paths.ts (pulled in by the inspector) asks Electron for folders at import time.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

const ready: PreflightResult = { ok: true, checks: [], blockers: [] };

const check = (over: Partial<ToolCheck> = {}): ToolCheck => ({
  id: 'node',
  label: 'Node.js',
  status: 'ok',
  detail: 'v22.12.0',
  blocking: true,
  ...over
});

const blocked = (over: Partial<PreflightResult> = {}): PreflightResult => ({
  ok: false,
  checks: [],
  blockers: [],
  ...over
});

const issue = (label = 'Port'): ValidationIssue => ({ path: 'server.port', label, message: 'Must be 1-65535' });

describe('ReadinessTracker', () => {
  it('stores the result of the latest check for a profile', () => {
    const t = new ReadinessTracker();
    const token = t.begin('a');
    expect(t.complete('a', token, ready)).toBe(true);
    expect(t.get('a')).toBe(ready);
    expect(t.pending('a')).toBe(false);
  });

  it('has nothing for a profile that was never checked', () => {
    const t = new ReadinessTracker();
    expect(t.get('a')).toBeNull();
    expect(t.pending('a')).toBe(false);
  });

  it('is pending between begin and complete', () => {
    const t = new ReadinessTracker();
    const token = t.begin('a');
    expect(t.pending('a')).toBe(true);
    t.complete('a', token, ready);
    expect(t.pending('a')).toBe(false);
  });

  it('discards a stale token and stores nothing for it', () => {
    const t = new ReadinessTracker();
    const old = t.begin('a');
    const fresh = t.begin('a');
    const stale = blocked({ blockers: ['old answer'] });
    expect(t.complete('a', old, stale)).toBe(false);
    expect(t.get('a')).toBeNull();
    expect(t.pending('a')).toBe(true);
    expect(t.complete('a', fresh, ready)).toBe(true);
    expect(t.get('a')).toBe(ready);
  });

  it('does not let a late stale result overwrite a newer completed one', () => {
    const t = new ReadinessTracker();
    const old = t.begin('a');
    const fresh = t.begin('a');
    t.complete('a', fresh, ready);
    expect(t.complete('a', old, blocked({ blockers: ['late'] }))).toBe(false);
    expect(t.get('a')).toBe(ready);
    expect(t.pending('a')).toBe(false);
  });

  it('keeps results per profile: B never shows on A', () => {
    const t = new ReadinessTracker();
    const a = t.begin('a');
    const b = t.begin('b');
    const bResult = blocked({ blockers: ['b is blocked'] });
    t.complete('b', b, bResult);
    expect(t.get('b')).toBe(bResult);
    expect(t.get('a')).toBeNull();
    expect(t.pending('a')).toBe(true);
    expect(t.pending('b')).toBe(false);
    t.complete('a', a, ready);
    expect(t.get('a')).toBe(ready);
    expect(t.get('b')).toBe(bResult);
  });

  it('a token for one profile cannot complete another profile', () => {
    const t = new ReadinessTracker();
    const a = t.begin('a');
    t.begin('b');
    // Tokens are global, so a's token is not b's current token.
    expect(t.complete('b', a, ready)).toBe(false);
    expect(t.get('b')).toBeNull();
  });

  it('keeps the last completed result while a newer check is pending', () => {
    const t = new ReadinessTracker();
    t.complete('a', t.begin('a'), ready);
    t.begin('a');
    expect(t.pending('a')).toBe(true);
    expect(t.get('a')).toBe(ready);
  });

  it('hands out increasing tokens', () => {
    const t = new ReadinessTracker();
    const first = t.begin('a');
    const second = t.begin('a');
    expect(second).toBeGreaterThan(first);
  });
});

describe('blockerLines', () => {
  it('lists the blockers, then each blocking check with its fix', () => {
    const r = blocked({
      blockers: ['Port 4723 is already in use by another app. Choose another port or close that app.'],
      checks: [
        check({ id: 'appium', label: 'Appium', status: 'missing', detail: 'not found', remediation: 'Install Appium 3.' }),
        check({ id: 'adb', label: 'adb', status: 'missing', detail: 'adb not found' })
      ]
    });
    expect(blockerLines(r)).toEqual([
      'Port 4723 is already in use by another app. Choose another port or close that app.',
      'Appium: Install Appium 3.',
      'adb: adb not found'
    ]);
  });

  it('leaves out checks that pass, only warn, or do not block', () => {
    const r = blocked({
      checks: [
        check({ id: 'node', status: 'ok' }),
        check({ id: 'ios', label: 'iPhone support', status: 'warn', blocking: false, detail: 'optional' }),
        check({ id: 'x', label: 'X', status: 'missing', blocking: false, detail: 'optional' })
      ],
      blockers: ['one']
    });
    expect(blockerLines(r)).toEqual(['one']);
  });

  it('never comes back empty for a result that says it is not ok', () => {
    expect(blockerLines(blocked())).toEqual(['Not ready to start yet.']);
  });
});

describe('firstBlocker', () => {
  it('prefers the first blockers entry', () => {
    const r = blocked({
      blockers: ['Port 4723 is already in use by another app. Choose another port or close that app.', 'second'],
      checks: [check({ status: 'missing', remediation: 'Install Node' })]
    });
    expect(firstBlocker(r)).toBe('Port 4723 is already in use by another app. Choose another port or close that app.');
  });

  it("falls back to the first blocking non-ok check's remediation", () => {
    const r = blocked({
      checks: [
        check({ id: 'a', status: 'missing', blocking: false, remediation: 'not this one' }),
        check({ id: 'b', status: 'ok', blocking: true, remediation: 'nor this one' }),
        check({ id: 'c', status: 'missing', blocking: true, detail: 'not found', remediation: 'Install Node 22' })
      ]
    });
    expect(firstBlocker(r)).toBe('Install Node 22');
  });

  it("uses the blocking check's detail when it has no remediation", () => {
    const r = blocked({ checks: [check({ status: 'warn', blocking: true, detail: 'v18.0.0 is too old' })] });
    expect(firstBlocker(r)).toBe('v18.0.0 is too old');
  });

  it('says so plainly when nothing explains the block', () => {
    expect(firstBlocker(blocked())).toBe('Not ready to start yet.');
    const onlyNonBlocking = blocked({ checks: [check({ status: 'missing', blocking: false, remediation: 'x' })] });
    expect(firstBlocker(onlyNonBlocking)).toBe('Not ready to start yet.');
  });
});

describe('decideStart', () => {
  const base = { status: 'stopped' as const, issues: [] as ValidationIssue[], readiness: ready, checking: false };

  it.each(['starting', 'running', 'stopping'] as const)('is active while %s, whatever else is wrong', (status) => {
    expect(decideStart({ ...base, status, issues: [issue()], readiness: blocked({ blockers: ['x'] }) })).toEqual({
      ok: false,
      kind: 'active'
    });
  });

  it.each(['stopped', 'crashed'] as const)('can start from %s', (status) => {
    expect(decideStart({ ...base, status })).toEqual({ ok: true });
  });

  it('is invalid with the first issue and the count', () => {
    const issues = [issue('Port'), issue('Host'), issue('Timeout')];
    expect(decideStart({ ...base, issues })).toEqual({ ok: false, kind: 'invalid', issue: issues[0], count: 3 });
  });

  it('puts invalid ahead of not-ready', () => {
    const d = decideStart({ ...base, issues: [issue()], readiness: blocked({ blockers: ['no plugin'] }) });
    expect(d).toMatchObject({ ok: false, kind: 'invalid' });
  });

  it('puts invalid ahead of checking', () => {
    const d = decideStart({ ...base, issues: [issue()], readiness: null, checking: true });
    expect(d).toMatchObject({ ok: false, kind: 'invalid' });
  });

  it('is checking when there is no answer yet and one is on the way', () => {
    expect(decideStart({ ...base, readiness: null, checking: true })).toEqual({ ok: false, kind: 'checking' });
  });

  it('trusts the last answer while a newer check runs', () => {
    expect(decideStart({ ...base, readiness: ready, checking: true })).toEqual({ ok: true });
    const d = decideStart({ ...base, readiness: blocked({ blockers: ['no plugin'] }), checking: true });
    expect(d).toEqual({ ok: false, kind: 'not-ready', reason: 'no plugin' });
  });

  it('is not-ready with the first blocker as the reason', () => {
    const d = decideStart({ ...base, readiness: blocked({ blockers: ['Port 4723 is in use', 'other'] }) });
    expect(d).toEqual({ ok: false, kind: 'not-ready', reason: 'Port 4723 is in use' });
  });

  it('is ok when the readiness is unknown and nothing is checking', () => {
    expect(decideStart({ ...base, readiness: null, checking: false })).toEqual({ ok: true });
  });

  it('is ok when everything is fine', () => {
    expect(decideStart(base)).toEqual({ ok: true });
  });
});

describe('blockedReason', () => {
  it('names the first setting to fix, singular', () => {
    const d: StartDecision = { ok: false, kind: 'invalid', issue: issue('Port'), count: 1 };
    expect(blockedReason(d)).toBe('Fix 1 setting first: Port');
  });

  it('pluralises the count', () => {
    const d: StartDecision = { ok: false, kind: 'invalid', issue: issue('Host'), count: 3 };
    expect(blockedReason(d)).toBe('Fix 3 settings first: Host');
  });

  it('is the reason when not ready', () => {
    expect(blockedReason({ ok: false, kind: 'not-ready', reason: 'Install Node 22' })).toBe('Install Node 22');
  });

  it('says it is checking', () => {
    expect(blockedReason({ ok: false, kind: 'checking' })).toBe('Checking…');
  });

  it('has nothing to say when starting is fine or the server is already active', () => {
    expect(blockedReason({ ok: true })).toBeNull();
    expect(blockedReason({ ok: false, kind: 'active' })).toBeNull();
  });
});

describe('ToolchainInspector.preflight reasons', () => {
  const profile = { server: { port: 4723 } } as Profile;

  function inspector(over: { portBusy: boolean; pluginInstalled: boolean }): ToolchainInspector {
    const i = new ToolchainInspector();
    vi.spyOn(i, 'checkAll').mockResolvedValue([]);
    vi.spyOn(i, 'isPluginInstalled').mockResolvedValue(over.pluginInstalled);
    (i as unknown as { portInUse: () => Promise<boolean> }).portInUse = async () => over.portBusy;
    return i;
  }

  it('says a busy port belongs to another app', async () => {
    const r = await inspector({ portBusy: true, pluginInstalled: true }).preflight(profile, '/home');
    expect(r.ok).toBe(false);
    expect(r.blockers).toEqual(['Port 4723 is already in use by another app. Choose another port or close that app.']);
  });

  it('sends a missing plugin to Set up on the Health tab', async () => {
    const r = await inspector({ portBusy: false, pluginInstalled: false }).preflight(profile, '/home');
    expect(r.ok).toBe(false);
    expect(r.blockers).toEqual([
      "Run Set up on the Health tab first. Xenon isn't installed in the Appium folder this profile uses."
    ]);
  });

  it('has no blockers when the port is free and the plugin is installed', async () => {
    const r = await inspector({ portBusy: false, pluginInstalled: true }).preflight(profile, '/home');
    expect(r).toEqual({ ok: true, checks: [], blockers: [] });
  });
});

const profile = (id = 'a', over: Partial<Profile['server']> = {}): Profile => ({
  id,
  name: id,
  settings: {},
  server: { port: 4723, basePath: '/wd/hub', appiumHome: '', keepAliveTimeout: 800, ...over },
  secretRefs: [],
  env: {},
  createdAt: 0,
  updatedAt: 0
});

/** A preflight whose answer the test releases by hand, to order slow and fast checks. */
function deferred() {
  let resolve!: (r: PreflightResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<PreflightResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(shown: string | null = 'a') {
  const tracker = new ReadinessTracker();
  const events: string[] = [];
  const state = { shown };
  const run = (p: Profile, preflight: (p: Profile) => Promise<PreflightResult>) =>
    runCheck({
      tracker,
      profile: p,
      preflight,
      onBegin: (id, last) => events.push(`begin ${id} last=${last ? (last.ok ? 'ok' : 'blocked') : 'none'}`),
      onApply: (id, r) => events.push(`apply ${id} ${r.ok ? 'ok' : 'blocked'}`),
      isShown: (id) => state.shown === id
    });
  return { tracker, events, state, run };
}

describe('runCheck', () => {
  it('begins, then applies the answer for the profile on screen', async () => {
    const h = harness();
    const r = await h.run(profile('a'), async () => ready);
    expect(r).toBe(ready);
    expect(h.events).toEqual(['begin a last=none', 'apply a ok']);
    expect(h.tracker.get('a')).toBe(ready);
  });

  it('hands the previous answer to onBegin so it keeps showing while the new check runs', async () => {
    const h = harness();
    await h.run(profile('a'), async () => blocked({ blockers: ['x'] }));
    await h.run(profile('a'), async () => ready);
    expect(h.events).toEqual(['begin a last=none', 'apply a blocked', 'begin a last=blocked', 'apply a ok']);
  });

  it('discards a slow answer that a newer check has overtaken', async () => {
    const h = harness();
    const slow = deferred();
    const first = h.run(profile('a'), () => slow.promise);
    const second = h.run(profile('a'), async () => ready);
    await second;
    slow.resolve(blocked({ blockers: ['old'] }));
    // The caller still gets the answer it asked for; the screen does not.
    expect((await first).ok).toBe(false);
    expect(h.events).toEqual(['begin a last=none', 'begin a last=none', 'apply a ok']);
    expect(h.tracker.get('a')).toBe(ready);
  });

  it('keeps an answer for a profile the user has left, without showing it', async () => {
    const h = harness('a');
    const slow = deferred();
    const pending = h.run(profile('a'), () => slow.promise);
    h.state.shown = 'b';
    slow.resolve(blocked({ blockers: ['a is blocked'] }));
    await pending;
    expect(h.events).toEqual(['begin a last=none']);
    // Coming back to it later starts from what was learned.
    expect(h.tracker.get('a')?.blockers).toEqual(['a is blocked']);
  });

  it("never lets one profile's answer land on another", async () => {
    const h = harness('b');
    const a = deferred();
    const b = deferred();
    const runA = h.run(profile('a'), () => a.promise);
    const runB = h.run(profile('b'), () => b.promise);
    b.resolve(ready);
    a.resolve(blocked({ blockers: ['a only'] }));
    await Promise.all([runA, runB]);
    expect(h.events).toEqual(['begin a last=none', 'begin b last=none', 'apply b ok']);
    expect(h.tracker.get('a')?.ok).toBe(false);
    expect(h.tracker.get('b')?.ok).toBe(true);
  });

  it('turns a failed request into a result that says so, so Checking never sticks', async () => {
    const h = harness();
    const r = await h.run(profile('a'), async () => {
      throw new Error('ipc went away');
    });
    expect(r).toBe(CHECK_FAILED);
    expect(h.events).toEqual(['begin a last=none', 'apply a blocked']);
    expect(h.tracker.pending('a')).toBe(false);
  });

  it('checks the profile it was handed, as it is now', async () => {
    const h = harness();
    const seen: number[] = [];
    await h.run(profile('a', { port: 4799 }), async (p) => {
      seen.push(p.server.port);
      return ready;
    });
    expect(seen).toEqual([4799]);
  });
});

describe('CHECK_FAILED', () => {
  it('blocks Start with a plain reason that points at Re-check', () => {
    expect(CHECK_FAILED.ok).toBe(false);
    expect(blockedReason(decideStart({ status: 'stopped', issues: [], readiness: CHECK_FAILED, checking: false }))).toBe(
      "Couldn't check whether this Mac is ready. Press Re-check on the Health tab."
    );
  });
});

describe('recheckKey', () => {
  const ticks = { focus: 1, setup: 2, recheck: 3, serverStopped: 4 };

  it('takes the profile id, port and Appium folder, and every tick', () => {
    expect(recheckKey(profile('a', { port: 4800, appiumHome: '/h' }), ticks)).toEqual({
      profileId: 'a',
      port: 4800,
      appiumHome: '/h',
      ...ticks
    });
  });

  it('has no profile id without a profile', () => {
    expect(recheckKey(null, ticks).profileId).toBeNull();
  });
});

describe('planRecheck', () => {
  const base: RecheckKey = {
    profileId: 'a',
    port: 4723,
    appiumHome: '',
    focus: 0,
    setup: 0,
    recheck: 0,
    serverStopped: 0
  };

  it('checks at once the first time a profile is on screen', () => {
    expect(planRecheck(null, base)).toBe('now');
  });

  it('checks at once when another profile is selected', () => {
    expect(planRecheck(base, { ...base, profileId: 'b' })).toBe('now');
  });

  it('checks at once when a profile appears after there was none', () => {
    expect(planRecheck({ ...base, profileId: null }, base)).toBe('now');
  });

  it.each([
    ['port', { port: 4800 }],
    ['Appium folder', { appiumHome: '/elsewhere' }],
    ['window focus', { focus: 1 }],
    ['a finished setup', { setup: 1 }],
    ['Re-check', { recheck: 1 }],
    ['the server stopping', { serverStopped: 1 }]
  ] as [string, Partial<RecheckKey>][])('waits out the debounce after %s changes', (_label, change) => {
    expect(planRecheck(base, { ...base, ...change })).toBe('later');
  });

  it('does nothing when nothing changed', () => {
    expect(planRecheck(base, { ...base })).toBe('none');
  });

  it('does nothing without a profile', () => {
    expect(planRecheck(base, { ...base, profileId: null })).toBe('none');
  });

  it('a profile switch wins over a tick that changed in the same render', () => {
    expect(planRecheck(base, { ...base, profileId: 'b', focus: 1 })).toBe('now');
  });
});

describe('startFailureMessage', () => {
  it('uses the message of an Error', () => {
    expect(startFailureMessage(new Error('A server is already running. Stop it before starting another.'))).toBe(
      'A server is already running. Stop it before starting another.'
    );
  });

  it("drops the channel Electron puts in front of an error thrown in the main process", () => {
    expect(
      startFailureMessage(new Error("Error invoking remote method 'server:start': Error: Could not find appium."))
    ).toBe('Could not find appium.');
  });

  it('copes with a thrown string, and with nothing useful at all', () => {
    expect(startFailureMessage('plain text')).toBe('plain text');
    expect(startFailureMessage(new Error(''))).toBe("Couldn't start the server.");
    expect(startFailureMessage(undefined)).toBe("Couldn't start the server.");
  });
});
