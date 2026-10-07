import { describe, expect, it } from 'vitest';
import { PLACES, crashAlert, setupNeedsAttention } from '../src/renderer/src/navigation';
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
