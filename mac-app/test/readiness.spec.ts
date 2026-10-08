import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_FAILED,
  ReadinessTracker,
  afterStartCheck,
  blockedReason,
  decideStart,
  firstBlocker,
  planRecheck,
  recheckKey,
  runCheck,
  showsBlockerList,
  startFailureMessage,
  type RecheckKey,
  type StartDecision
} from '../src/renderer/src/readiness';
import { ToolchainInspector } from '../src/main/ToolchainInspector';
import { NOT_INSTALLED_MESSAGE, portInUseMessage } from '../src/shared/preflightMessages';
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
  const base = {
    status: 'stopped' as const,
    issues: [] as ValidationIssue[],
    readiness: ready,
    checking: false,
    installing: false
  };

  it.each(['starting', 'running', 'stopping'] as const)('is active while %s, whatever else is wrong', (status) => {
    expect(decideStart({ ...base, status, issues: [issue()], readiness: blocked({ blockers: ['x'] }) })).toEqual({
      ok: false,
      kind: 'active'
    });
  });

  it.each(['stopped', 'crashed'] as const)('can start from %s', (status) => {
    expect(decideStart({ ...base, status })).toEqual({ ok: true });
  });

  // Set up is rewriting the Appium folder a start would launch from.
  describe('while Set up runs', () => {
    const running = { ...base, installing: true };

    it('is setup-running', () => {
      expect(decideStart(running)).toEqual({ ok: false, kind: 'setup-running' });
    });

    it('beats validation issues', () => {
      expect(decideStart({ ...running, issues: [issue()] })).toEqual({ ok: false, kind: 'setup-running' });
    });

    it('beats a not-ready answer, and an answer still being fetched', () => {
      expect(decideStart({ ...running, readiness: blocked({ blockers: ['no plugin'] }) })).toEqual({
        ok: false,
        kind: 'setup-running'
      });
      expect(decideStart({ ...running, readiness: null, checking: true })).toEqual({
        ok: false,
        kind: 'setup-running'
      });
    });

    it('is still beaten by a server that is active', () => {
      expect(decideStart({ ...running, status: 'running' })).toEqual({ ok: false, kind: 'active' });
    });

    it('lets Start back as soon as Set up is over', () => {
      expect(decideStart({ ...running, installing: false })).toEqual({ ok: true });
    });
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

  it('says to wait while Set up runs', () => {
    expect(blockedReason({ ok: false, kind: 'setup-running' })).toBe('Wait for Set up to finish.');
  });

  it('has nothing to say when starting is fine or the server is already active', () => {
    expect(blockedReason({ ok: true })).toBeNull();
    expect(blockedReason({ ok: false, kind: 'active' })).toBeNull();
  });
});

describe('showsBlockerList', () => {
  const base = { readiness: blocked({ blockers: ['x'] }), serverActive: false, installing: false };

  it('lists why Start is off after a failed check', () => {
    expect(showsBlockerList(base)).toBe(true);
  });

  it('has nothing to list before a check, or after a good one', () => {
    expect(showsBlockerList({ ...base, readiness: null })).toBe(false);
    expect(showsBlockerList({ ...base, readiness: ready })).toBe(false);
  });

  it('stays quiet while our own server is active', () => {
    expect(showsBlockerList({ ...base, serverActive: true })).toBe(false);
  });

  it('stays quiet while Set up runs, because the status bar already says to wait and the answer is changing', () => {
    expect(showsBlockerList({ ...base, installing: true })).toBe(false);
  });
});

describe('afterStartCheck', () => {
  it('starts when the check passed and nothing else began meanwhile', () => {
    expect(afterStartCheck(ready, false)).toBe('start');
  });

  it('sends the person to Setup when the check failed', () => {
    expect(afterStartCheck(blocked({ blockers: ['x'] }), false)).toBe('fix');
    expect(afterStartCheck(null, false)).toBe('fix');
  });

  it('does not start when Set up began during the check, even though the check passed', () => {
    expect(afterStartCheck(ready, true)).toBe('wait');
  });

  it('only waits, rather than sending anywhere, when Set up began and the check failed', () => {
    expect(afterStartCheck(blocked({ blockers: ['x'] }), true)).toBe('wait');
  });
});

describe('preflightMessages', () => {
  // Main writes these blockers and the renderer reads them, so both take them from one place.
  it('says a port is taken by another app, and what to do', () => {
    expect(portInUseMessage(4799)).toBe(
      'Port 4799 is already in use by another app. Choose another port or close that app.'
    );
  });

  it('sends a missing Xenon to Set up', () => {
    expect(NOT_INSTALLED_MESSAGE).toBe("Run Set up first. Xenon isn't installed in the Appium folder this profile uses.");
  });
});

describe('ToolchainInspector.preflight reasons', () => {
  const profile = { server: { port: 4723 } } as Profile;
  const portBlocker = 'Port 4723 is already in use by another app. Choose another port or close that app.';
  const pluginBlocker = "Run Set up first. Xenon isn't installed in the Appium folder this profile uses.";

  function inspector(over: { portBusy: boolean; pluginInstalled: boolean; checks?: ToolCheck[] }) {
    const i = new ToolchainInspector();
    vi.spyOn(i, 'checkAll').mockResolvedValue(over.checks ?? []);
    const isPluginInstalled = vi.spyOn(i, 'isPluginInstalled').mockResolvedValue(over.pluginInstalled);
    const portInUse = vi.fn(async () => over.portBusy);
    (i as unknown as { portInUse: () => Promise<boolean> }).portInUse = portInUse;
    return { i, isPluginInstalled, portInUse };
  }

  it('says a busy port belongs to another app', async () => {
    const r = await inspector({ portBusy: true, pluginInstalled: true }).i.preflight(profile, '/home');
    expect(r.ok).toBe(false);
    expect(r.blockers).toEqual([portBlocker]);
  });

  it('sends a missing plugin to Set up', async () => {
    const r = await inspector({ portBusy: false, pluginInstalled: false }).i.preflight(profile, '/home');
    expect(r.ok).toBe(false);
    expect(r.blockers).toEqual([pluginBlocker]);
  });

  it('has no blockers when the port is free and the plugin is installed', async () => {
    const r = await inspector({ portBusy: false, pluginInstalled: true }).i.preflight(profile, '/home');
    expect(r).toEqual({ ok: true, checks: [], blockers: [] });
  });

  describe('when our own server is active', () => {
    it('does not look at the port, so its own server is not blamed on another app', async () => {
      const { i, portInUse } = inspector({ portBusy: true, pluginInstalled: true });
      const r = await i.preflight(profile, '/home', { skipPortCheck: true });
      expect(portInUse).not.toHaveBeenCalled();
      expect(r).toEqual({ ok: true, checks: [], blockers: [] });
    });

    it('still reports everything else', async () => {
      const r = await inspector({ portBusy: true, pluginInstalled: false }).i.preflight(profile, '/home', {
        skipPortCheck: true
      });
      expect(r.blockers).toEqual([pluginBlocker]);
    });

    it('looks at the port when not asked to skip it', async () => {
      const { i, portInUse } = inspector({ portBusy: false, pluginInstalled: true });
      await i.preflight(profile, '/home', { skipPortCheck: false });
      await i.preflight(profile, '/home');
      expect(portInUse).toHaveBeenCalledTimes(2);
    });
  });

  describe('when Appium itself is the problem, the first reason is about Appium', () => {
    const appium = (over: Partial<ToolCheck>) =>
      check({ id: 'appium', label: 'Appium', status: 'missing', detail: 'appium not found on PATH', ...over });

    it('does not also say the plugin is not installed when Appium is missing', async () => {
      const checks = [appium({ blocking: true, remediation: 'Install Appium 3: npm i -g appium' })];
      const { i, isPluginInstalled } = inspector({ portBusy: false, pluginInstalled: false, checks });
      const r = await i.preflight(profile, '/home');
      expect(r.ok).toBe(false);
      expect(r.blockers).toEqual([]);
      expect(firstBlocker(r)).toBe('Install Appium 3: npm i -g appium');
      expect(isPluginInstalled).not.toHaveBeenCalled();
    });

    it('does not say it when Appium is too old either', async () => {
      const checks = [appium({ status: 'warn', detail: '2.5.0', blocking: true, remediation: 'Xenon needs Appium 3.1.1 or newer.' })];
      const r = await inspector({ portBusy: false, pluginInstalled: false, checks }).i.preflight(profile, '/home');
      expect(r.blockers).toEqual([]);
      expect(firstBlocker(r)).toBe('Xenon needs Appium 3.1.1 or newer.');
    });

    it('keeps a busy port blocker, which Set up cannot cure and the person can act on', async () => {
      const checks = [appium({ blocking: true })];
      const r = await inspector({ portBusy: true, pluginInstalled: false, checks }).i.preflight(profile, '/home');
      expect(r.blockers).toEqual([portBlocker]);
    });

    it('still says the plugin is missing when Appium is fine', async () => {
      const checks = [appium({ status: 'ok', detail: '3.1.1', blocking: false })];
      const r = await inspector({ portBusy: false, pluginInstalled: false, checks }).i.preflight(profile, '/home');
      expect(r.blockers).toEqual([pluginBlocker]);
    });

    it('still says it when some other check blocks, since that does not make Appium the problem', async () => {
      const checks = [check({ id: 'adb', blocking: true, status: 'warn' }), appium({ status: 'ok', blocking: false })];
      const r = await inspector({ portBusy: false, pluginInstalled: false, checks }).i.preflight(profile, '/home');
      expect(r.blockers).toEqual([pluginBlocker]);
    });
  });

  describe('when Node.js is the problem, the first reason is about Node.js', () => {
    const node = (over: Partial<ToolCheck>) =>
      check({ id: 'node', status: 'warn', detail: 'v21.7.0', blocking: true, remediation: 'Appium 3.x requires Node 22.', ...over });
    const appiumOk = check({ id: 'appium', label: 'Appium', status: 'ok', detail: '3.1.1', blocking: false });

    it('does not also say the plugin is not installed when Node.js is unsupported', async () => {
      const checks = [node({}), appiumOk];
      const { i, isPluginInstalled } = inspector({ portBusy: false, pluginInstalled: false, checks });
      const r = await i.preflight(profile, '/home');
      expect(r.ok).toBe(false);
      expect(r.blockers).toEqual([]);
      expect(firstBlocker(r)).toBe('Appium 3.x requires Node 22.');
      // Asking the plugin list under an unsupported Node fails whether or not Xenon is installed.
      expect(isPluginInstalled).not.toHaveBeenCalled();
    });

    it('does not say it when Node.js is missing either', async () => {
      const checks = [node({ status: 'missing', detail: 'node not found on PATH' }), appiumOk];
      const r = await inspector({ portBusy: false, pluginInstalled: false, checks }).i.preflight(profile, '/home');
      expect(r.blockers).toEqual([]);
    });

    it('keeps a busy port blocker, which Set up cannot cure and the person can act on', async () => {
      const r = await inspector({ portBusy: true, pluginInstalled: false, checks: [node({}), appiumOk] }).i.preflight(profile, '/home');
      expect(r.blockers).toEqual([portBlocker]);
    });

    it('still says the plugin is missing once Node.js is fine', async () => {
      const checks = [node({ status: 'ok', detail: 'v22.12.0', blocking: false }), appiumOk];
      const r = await inspector({ portBusy: false, pluginInstalled: false, checks }).i.preflight(profile, '/home');
      expect(r.blockers).toEqual([pluginBlocker]);
    });
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
  it('blocks Start with a plain reason that points at Check again on Setup', () => {
    expect(CHECK_FAILED.ok).toBe(false);
    expect(blockedReason(decideStart({ status: 'stopped', issues: [], readiness: CHECK_FAILED, checking: false }))).toBe(
      "Couldn't check whether this Mac is ready. Press Check again on Setup."
    );
  });
});

describe('recheckKey', () => {
  const ticks = { focus: 1, setup: 2, recheck: 3 };

  it('takes the profile id, port and Appium folder, every tick, and whether a server is active or Set up is running', () => {
    expect(recheckKey(profile('a', { port: 4800, appiumHome: '/h' }), ticks, 'stopped', false)).toEqual({
      profileId: 'a',
      port: 4800,
      appiumHome: '/h',
      ...ticks,
      serverActive: false,
      installing: false
    });
  });

  it('carries whether Set up is running', () => {
    expect(recheckKey(profile('a'), ticks, 'stopped', true).installing).toBe(true);
  });

  it.each([
    ['starting', true],
    ['running', true],
    ['stopping', true],
    ['stopped', false],
    ['crashed', false]
  ] as const)('reads %s as serverActive=%s', (status, active) => {
    expect(recheckKey(profile('a'), ticks, status, false).serverActive).toBe(active);
  });

  it('has no profile id without a profile', () => {
    expect(recheckKey(null, ticks, 'stopped', false).profileId).toBeNull();
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
    serverActive: false,
    installing: false
  };
  const active: RecheckKey = { ...base, serverActive: true };

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
    ['Check again', { recheck: 1 }]
  ] as [string, Partial<RecheckKey>][])('waits out the debounce after %s changes while stopped', (_label, change) => {
    expect(planRecheck(base, { ...base, ...change })).toBe('later');
  });

  it('does nothing when nothing changed', () => {
    expect(planRecheck(base, { ...base })).toBe('none');
    expect(planRecheck(active, { ...active })).toBe('none');
  });

  it('does nothing without a profile', () => {
    expect(planRecheck(base, { ...base, profileId: null })).toBe('none');
  });

  it('a profile switch wins over a tick that changed in the same render', () => {
    expect(planRecheck(base, { ...base, profileId: 'b', focus: 1 })).toBe('now');
  });

  describe('while our own server is active it owns the port, so nothing is checked', () => {
    it('not when the server starts', () => {
      expect(planRecheck(base, active)).toBe('none');
    });

    it.each([
      ['port', { port: 4800 }],
      ['Appium folder', { appiumHome: '/elsewhere' }],
      ['window focus', { focus: 1 }],
      ['a finished setup', { setup: 1 }],
      ['Check again', { recheck: 1 }]
    ] as [string, Partial<RecheckKey>][])('not after %s changes', (_label, change) => {
      expect(planRecheck(active, { ...active, ...change })).toBe('none');
    });

    it('not for another profile, nor for the first look at a profile', () => {
      expect(planRecheck(active, { ...active, profileId: 'b' })).toBe('none');
      expect(planRecheck(null, active)).toBe('none');
    });
  });

  describe('when the server ends (stopped, or crashed) its port is free again', () => {
    it('checks at once, not after the debounce', () => {
      expect(planRecheck(active, base)).toBe('now');
    });

    it('checks at once even if something else changed while it ran', () => {
      expect(planRecheck(active, { ...base, port: 4800, focus: 3 })).toBe('now');
    });

    it('then goes back to the debounce for edits', () => {
      expect(planRecheck(base, { ...base, port: 4800 })).toBe('later');
    });
  });
});

describe('planRecheck while Set up runs', () => {
  const base: RecheckKey = {
    profileId: 'a',
    port: 4723,
    appiumHome: '',
    focus: 0,
    setup: 0,
    recheck: 0,
    serverActive: false,
    installing: false
  };
  const installing: RecheckKey = { ...base, installing: true };

  // Set up is changing the very things a check reads (Appium, its folder, the
  // plugin), so a check mid-run reports a half-installed Mac, and a failing one
  // can leave Start off for no reason once the run is done.
  describe('nothing is checked', () => {
    it('when Set up starts', () => {
      expect(planRecheck(base, installing)).toBe('none');
    });

    it.each([
      ['port', { port: 4800 }],
      ['Appium folder', { appiumHome: '/elsewhere' }],
      ['window focus', { focus: 1 }],
      ['Check again', { recheck: 1 }]
    ] as [string, Partial<RecheckKey>][])('after %s changes mid-run', (_label, change) => {
      expect(planRecheck(installing, { ...installing, ...change })).toBe('none');
    });

    it('for another profile, nor for the first look at a profile', () => {
      expect(planRecheck(installing, { ...installing, profileId: 'b' })).toBe('none');
      expect(planRecheck(null, installing)).toBe('none');
    });

    it('when nothing changed', () => {
      expect(planRecheck(installing, { ...installing })).toBe('none');
    });

    it('when the server starts while Set up runs, nor when Set up ends with the server still active', () => {
      expect(planRecheck(installing, { ...installing, serverActive: true })).toBe('none');
      expect(planRecheck({ ...installing, serverActive: true }, { ...base, serverActive: true })).toBe('none');
    });
  });

  describe('when Set up ends', () => {
    it('checks at once, not after the debounce', () => {
      expect(planRecheck(installing, base)).toBe('now');
    });

    it('checks at once even though the finished run also bumped the setup tick', () => {
      expect(planRecheck(installing, { ...base, setup: 1 })).toBe('now');
    });

    it('checks at once even if something else changed while it ran', () => {
      expect(planRecheck(installing, { ...base, port: 4800, focus: 3 })).toBe('now');
    });

    it('then goes back to the debounce for edits', () => {
      expect(planRecheck(base, { ...base, port: 4800 })).toBe('later');
    });
  });

  it('does nothing without a profile', () => {
    expect(planRecheck(base, { ...installing, profileId: null })).toBe('none');
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
