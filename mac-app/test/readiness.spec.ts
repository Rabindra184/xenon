import { describe, expect, it, vi } from 'vitest';
import {
  ReadinessTracker,
  blockedReason,
  decideStart,
  firstBlocker,
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
