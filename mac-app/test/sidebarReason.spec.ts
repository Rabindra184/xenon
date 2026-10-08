import { describe, expect, it } from 'vitest';
import { sidebarBlockedReason } from '../src/renderer/src/sidebarReason';
import { blockedReason, decideStart, type StartDecision } from '../src/renderer/src/readiness';
import { findJargon } from './e2e/jargon';
import type { PreflightResult, ToolCheck } from '../src/shared/types';

// The reason under the sidebar's Start (R24): with technical details off, a
// Node.js or Appium that blocks a start is said in the plain sentence Home and
// Setup say, never in the check's own fix, which names commands. With technical
// details on, the check's own words stay. Everything else is Part A's reason.

const NODE_REMEDIATION = 'Install Node.js — Appium 3.x needs ^20.19 || ^22.12 || >=24 (e.g. via Homebrew: brew install node).';
const APPIUM_REMEDIATION = 'Install Appium 3: npm i -g appium';

const check = (over: Partial<ToolCheck>): ToolCheck => ({
  id: 'node',
  label: 'Node.js',
  status: 'ok',
  code: 'ok',
  detail: 'v22.12.0',
  blocking: false,
  ...over
});

const NODE_OK = check({});
const APPIUM_OK = check({ id: 'appium', label: 'Appium', detail: '3.1.1' });
const NODE_MISSING = check({
  status: 'missing',
  code: 'missing',
  detail: 'node not found on PATH',
  blocking: true,
  remediation: NODE_REMEDIATION
});
const NODE_WRONG = check({
  status: 'warn',
  code: 'unsupported',
  detail: 'v23.1.0',
  blocking: true,
  remediation: 'Appium 3.x requires Node ^20.19 || ^22.12 || >=24 (e.g. brew install node).'
});
const APPIUM_MISSING = check({
  id: 'appium',
  label: 'Appium',
  status: 'missing',
  code: 'missing',
  detail: 'appium not found on PATH',
  blocking: true,
  remediation: APPIUM_REMEDIATION
});
const APPIUM_OLD = check({
  id: 'appium',
  label: 'Appium',
  status: 'warn',
  code: 'unsupported',
  detail: '3.0.9',
  blocking: true,
  remediation: 'Xenon needs Appium 3.1.1 or newer.'
});

const answer = (checks: ToolCheck[], blockers: string[] = []): PreflightResult => ({ ok: false, checks, blockers });

/** What the sidebar would decide for this answer, with the server stopped and the settings fine. */
const decide = (r: PreflightResult | null, over: Partial<Parameters<typeof decideStart>[0]> = {}): StartDecision =>
  decideStart({ status: 'stopped', issues: [], readiness: r, checking: false, installing: false, ...over });

describe('sidebarBlockedReason', () => {
  it('says an Appium that is not installed in plain words, with no command in them', () => {
    const r = answer([NODE_OK, APPIUM_MISSING]);
    // Part A's reason is the check's own fix, commands and all.
    expect(blockedReason(decide(r))).toBe(APPIUM_REMEDIATION);
    const reason = sidebarBlockedReason(decide(r), r, false);
    expect(reason).toBe('Appium isn’t installed on this Mac. Xenon needs Appium 3.1.1 or newer.');
    expect(findJargon(reason ?? '', [])).toEqual([]);
  });

  it('says each Node.js and Appium outcome as Home and Setup do', () => {
    const plain = (c: ToolCheck, other: ToolCheck) => {
      const r = answer(c.id === 'node' ? [c, other] : [other, c]);
      return sidebarBlockedReason(decide(r), r, false);
    };
    expect(plain(NODE_MISSING, APPIUM_OK)).toBe('Node.js isn’t installed on this Mac. Appium needs it.');
    expect(plain(NODE_WRONG, APPIUM_OK)).toBe('This Mac’s Node.js version doesn’t work with Appium 3.');
    expect(plain(APPIUM_MISSING, NODE_OK)).toBe('Appium isn’t installed on this Mac. Xenon needs Appium 3.1.1 or newer.');
    expect(plain(APPIUM_OLD, NODE_OK)).toBe('This Mac’s Appium is too old. Xenon needs Appium 3.1.1 or newer.');
  });

  it('says the first blocking check, as Part A picks it, when both are in the way', () => {
    const r = answer([NODE_MISSING, APPIUM_MISSING]);
    expect(sidebarBlockedReason(decide(r), r, false)).toBe('Node.js isn’t installed on this Mac. Appium needs it.');
  });

  it('reads a check with no code from its status', () => {
    const { code: _drop, ...noCode } = NODE_WRONG;
    const r = answer([noCode, APPIUM_OK]);
    expect(sidebarBlockedReason(decide(r), r, false)).toBe('This Mac’s Node.js version doesn’t work with Appium 3.');
  });

  it('keeps the check’s own words with technical details on', () => {
    const r = answer([NODE_OK, APPIUM_MISSING]);
    expect(sidebarBlockedReason(decide(r), r, true)).toBe(APPIUM_REMEDIATION);
  });

  it('leaves a blocker main already words plainly as it is (the port, Xenon not installed)', () => {
    const port = 'Port 4723 is already in use by another app. Choose another port or close that app.';
    const r = answer([NODE_OK, APPIUM_MISSING], [port]);
    expect(sidebarBlockedReason(decide(r), r, false)).toBe(port);
    const notInstalled = "Run Set up first. Xenon isn't installed in the Appium folder this profile uses.";
    const r2 = answer([NODE_OK, APPIUM_OK], [notInstalled]);
    expect(sidebarBlockedReason(decide(r2), r2, false)).toBe(notInstalled);
  });

  it('leaves every other reason as Part A gives it', () => {
    const r = answer([NODE_OK, APPIUM_MISSING]);
    const cases: StartDecision[] = [
      { ok: true },
      { ok: false, kind: 'active' },
      { ok: false, kind: 'setup-running' },
      { ok: false, kind: 'checking' },
      { ok: false, kind: 'invalid', issue: { path: 'server.port', label: 'Port', message: 'Too big' }, count: 1 }
    ];
    for (const d of cases) {
      expect(sidebarBlockedReason(d, r, false)).toBe(blockedReason(d));
    }
  });

  it('leaves a reason that is not about the answer it is given as it is', () => {
    // A decision made from an older answer: the answer here has no check that gives its reason.
    const older = answer([NODE_OK, APPIUM_MISSING]);
    const now = answer([NODE_OK, APPIUM_OK], []);
    expect(sidebarBlockedReason(decide(older), now, false)).toBe(APPIUM_REMEDIATION);
    expect(sidebarBlockedReason(decide(older), null, false)).toBe(APPIUM_REMEDIATION);
  });

  it('leaves a blocking check that is not Node.js or Appium in the check’s own words', () => {
    const other = check({ id: 'other', label: 'Other', status: 'missing', code: 'missing', blocking: true, remediation: 'Fix it.' });
    const r = answer([NODE_OK, APPIUM_OK, other]);
    expect(sidebarBlockedReason(decide(r), r, false)).toBe('Fix it.');
  });
});
