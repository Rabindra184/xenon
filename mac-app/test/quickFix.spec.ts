import { describe, expect, it } from 'vitest';
import { answerIsForAnotherPort, blockerOf, quickFix, type Blocker } from '../src/renderer/src/quickFix';
import { NOT_INSTALLED_MESSAGE, portInUseMessage, portOfInUseMessage } from '../src/shared/preflightMessages';
import type { PreflightResult, ToolCheck, ValidationIssue } from '../src/shared/types';

const check = (over: Partial<ToolCheck> = {}): ToolCheck => ({
  id: 'node',
  label: 'Node.js',
  status: 'ok',
  detail: 'v22.12.0',
  blocking: true,
  ...over
});

const ok: PreflightResult = {
  ok: true,
  checks: [check(), check({ id: 'appium', label: 'Appium', detail: '3.1.0' })],
  blockers: []
};

const blocked = (over: Partial<PreflightResult> = {}): PreflightResult => ({
  ok: false,
  checks: ok.checks,
  blockers: [],
  ...over
});

const issue = (path = 'server.port', label = 'Port'): ValidationIssue => ({
  path,
  label,
  message: 'Must be 1-65535'
});

describe('blockerOf', () => {
  it('is null before the first check, with nothing invalid', () => {
    expect(blockerOf(null, [], 4723)).toBeNull();
  });

  it('is null when the check passed', () => {
    expect(blockerOf(ok, [], 4723)).toBeNull();
  });

  it('is invalid for a setting problem, with the first issue and how many there are', () => {
    const first = issue('server.port', 'Port');
    const second = issue('server.basePath', 'Base path');
    expect(blockerOf(ok, [first, second], 4723)).toEqual({ kind: 'invalid', issue: first, count: 2 });
  });

  it('is invalid before the first check too', () => {
    const first = issue();
    expect(blockerOf(null, [first], 4723)).toEqual({ kind: 'invalid', issue: first, count: 1 });
  });

  it('puts an invalid setting ahead of a port in use', () => {
    const first = issue();
    const r = blocked({ blockers: [portInUseMessage(4723)] });
    expect(blockerOf(r, [first], 4723)).toEqual({ kind: 'invalid', issue: first, count: 1 });
  });

  it('is port-in-use when a blocker is the message for this profile’s port', () => {
    const r = blocked({ blockers: [portInUseMessage(4723)] });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'port-in-use', port: 4723 });
  });

  it('does not take the message for another port as this one', () => {
    const r = blocked({ blockers: [portInUseMessage(4000)] });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'other', reason: portInUseMessage(4000) });
  });

  it('is not-installed when a blocker is the not-installed message', () => {
    const r = blocked({ blockers: [NOT_INSTALLED_MESSAGE] });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'not-installed' });
  });

  it('puts a port in use ahead of not installed', () => {
    const r = blocked({ blockers: [NOT_INSTALLED_MESSAGE, portInUseMessage(4723)] });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'port-in-use', port: 4723 });
  });

  it('is runtime for a blocking Node.js check that is not ok', () => {
    const r = blocked({ checks: [check({ id: 'node', status: 'missing' }), ok.checks[1]] });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'runtime', check: 'node' });
  });

  it('is runtime for a blocking Appium check that is not ok', () => {
    const r = blocked({ checks: [ok.checks[0], check({ id: 'appium', label: 'Appium', status: 'warn' })] });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'runtime', check: 'appium' });
  });

  it('puts not installed ahead of a runtime check', () => {
    const r = blocked({
      blockers: [NOT_INSTALLED_MESSAGE],
      checks: [check({ id: 'node', status: 'missing' }), ok.checks[1]]
    });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'not-installed' });
  });

  it('does not call a non-blocking Node.js or Appium check a runtime blocker', () => {
    const r = blocked({
      blockers: ['Something else is wrong.'],
      checks: [check({ id: 'node', status: 'warn', blocking: false }), ok.checks[1]]
    });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'other', reason: 'Something else is wrong.' });
  });

  it('is other with the first blocker for any other failure', () => {
    const r = blocked({ blockers: ['Something odd happened.', 'And another thing.'] });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'other', reason: 'Something odd happened.' });
  });

  it('is other with the first blocking check’s fix when there are no blockers', () => {
    const r = blocked({
      checks: [check({ id: 'custom', label: 'Custom', status: 'missing', remediation: 'Install the custom thing.' })]
    });
    expect(blockerOf(r, [], 4723)).toEqual({ kind: 'other', reason: 'Install the custom thing.' });
  });

  it('is other with the plain fallback when a failed check says nothing', () => {
    expect(blockerOf(blocked({ checks: [] }), [], 4723)).toEqual({
      kind: 'other',
      reason: 'Not ready to start yet.'
    });
  });
});

describe('quickFix', () => {
  it('offers the next free port when the port is in use', () => {
    const b: Blocker = { kind: 'port-in-use', port: 4723 };
    expect(quickFix(b, { freePort: 4724 })).toEqual({
      label: 'Use port 4724',
      action: { kind: 'set-port', port: 4724 }
    });
  });

  it('sends the person to Setup when the port is in use and no port is free', () => {
    const b: Blocker = { kind: 'port-in-use', port: 4723 };
    expect(quickFix(b, { freePort: null })).toEqual({
      label: 'See Setup',
      action: { kind: 'go', place: 'setup' }
    });
  });

  it('offers to set up this Mac when Xenon is not installed', () => {
    expect(quickFix({ kind: 'not-installed' }, { freePort: null })).toEqual({
      label: 'Set up this Mac',
      action: { kind: 'setup' }
    });
  });

  it('offers to fix an invalid setting where it is', () => {
    const b: Blocker = { kind: 'invalid', issue: issue('server.basePath', 'Base path'), count: 3 };
    expect(quickFix(b, { freePort: null })).toEqual({
      label: 'Fix it',
      action: { kind: 'focus', path: 'server.basePath' }
    });
  });

  it('offers the install guide when Node.js or Appium is missing or too old', () => {
    for (const check of ['node', 'appium'] as const) {
      expect(quickFix({ kind: 'runtime', check }, { freePort: 4724 })).toEqual({
        label: 'How to install',
        action: { kind: 'link', link: 'install' }
      });
    }
  });

  it('sends the person to Setup for anything else', () => {
    expect(quickFix({ kind: 'other', reason: 'Something odd happened.' }, { freePort: 4724 })).toEqual({
      label: 'See Setup',
      action: { kind: 'go', place: 'setup' }
    });
  });

  it('ignores the free port for a blocker that is not about the port', () => {
    expect(quickFix({ kind: 'not-installed' }, { freePort: 4724 }).action).toEqual({ kind: 'setup' });
  });
});

describe('portOfInUseMessage', () => {
  it('reads the port back out of the check’s own sentence', () => {
    for (const port of [1, 4723, 4799, 65535]) expect(portOfInUseMessage(portInUseMessage(port))).toBe(port);
  });

  it('is null for any other sentence', () => {
    expect(portOfInUseMessage(NOT_INSTALLED_MESSAGE)).toBeNull();
    expect(portOfInUseMessage('Port 4723 is in use.')).toBeNull();
    expect(portOfInUseMessage(`${portInUseMessage(4723)} And more.`)).toBeNull();
    expect(portOfInUseMessage('')).toBeNull();
  });
});

describe('answerIsForAnotherPort', () => {
  // After "Use port N" the profile's port is N at once, but the last answer still says the old port
  // is in use until the re-check comes back.
  it('is true when the answer says another port is in use', () => {
    expect(answerIsForAnotherPort(blocked({ blockers: [portInUseMessage(4723)] }), 4724)).toBe(true);
  });

  it('is true when another port is in use alongside other blockers', () => {
    expect(answerIsForAnotherPort(blocked({ blockers: [NOT_INSTALLED_MESSAGE, portInUseMessage(4723)] }), 4800)).toBe(
      true
    );
  });

  it('is false when the port in use is the profile’s own', () => {
    expect(answerIsForAnotherPort(blocked({ blockers: [portInUseMessage(4723)] }), 4723)).toBe(false);
  });

  it('is false when the answer says nothing about a port', () => {
    expect(answerIsForAnotherPort(ok, 4723)).toBe(false);
    expect(answerIsForAnotherPort(blocked({ blockers: [NOT_INSTALLED_MESSAGE] }), 4723)).toBe(false);
  });

  it('is false before there is any answer', () => {
    expect(answerIsForAnotherPort(null, 4723)).toBe(false);
  });
});
