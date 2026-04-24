import { describe, it, expect } from 'vitest';
import {
  buildStatusCounts,
  deviceNameOrFallback,
  platformLabel,
  osVersionLabel,
  formatAbsoluteTime,
  sessionDurationMs,
  humanDuration,
  shortId,
  humanizeFailureCategory,
} from './derive';

describe('buildStatusCounts', () => {
  it('counts passed/failed/running', () => {
    const s = [
      { status: 'ended' },
      { status: 'ended' },
      { status: 'failed' },
      { status: 'running' },
    ] as any;
    expect(buildStatusCounts(s)).toEqual({ all: 4, passed: 2, failed: 1, running: 1 });
  });

  it('treats "passed" status alias as passed', () => {
    expect(buildStatusCounts([{ status: 'passed' }] as any)).toEqual({
      all: 1, passed: 1, failed: 0, running: 0,
    });
  });

  it('handles empty array', () => {
    expect(buildStatusCounts([])).toEqual({ all: 0, passed: 0, failed: 0, running: 0 });
  });
});

describe('deviceNameOrFallback', () => {
  it('returns device_name when present', () => {
    expect(deviceNameOrFallback({ device_name: 'QA-01' } as any)).toBe('QA-01');
  });
  it('returns Unknown Device when missing or whitespace', () => {
    expect(deviceNameOrFallback({} as any)).toBe('Unknown Device');
    expect(deviceNameOrFallback({ device_name: '   ' } as any)).toBe('Unknown Device');
    expect(deviceNameOrFallback({ device_name: null } as any)).toBe('Unknown Device');
  });
});

describe('platformLabel', () => {
  it('normalizes ios and tvos', () => {
    expect(platformLabel({ device_platform: 'ios' } as any)).toBe('iOS');
    expect(platformLabel({ device_platform: 'tvos' } as any)).toBe('tvOS');
  });
  it('capitalizes other platforms', () => {
    expect(platformLabel({ device_platform: 'android' } as any)).toBe('Android');
  });
  it('returns em-dash when empty', () => {
    expect(platformLabel({} as any)).toBe('—');
  });
});

describe('osVersionLabel', () => {
  it('prefixes with v', () => {
    expect(osVersionLabel({ device_version: '13' } as any)).toBe('v13');
  });
  it('returns empty string when absent', () => {
    expect(osVersionLabel({} as any)).toBe('');
  });
});

describe('formatAbsoluteTime', () => {
  it('formats ISO string to dd/MM/yyyy, HH:mm:ss', () => {
    const out = formatAbsoluteTime('2026-04-23T06:53:25Z');
    expect(out).toMatch(/^\d{2}\/\d{2}\/2026, \d{2}:\d{2}:\d{2}$/);
  });
  it('returns em-dash for null', () => {
    expect(formatAbsoluteTime(null)).toBe('—');
  });
  it('returns em-dash for invalid string', () => {
    expect(formatAbsoluteTime('not-a-date')).toBe('—');
  });
});

describe('sessionDurationMs', () => {
  it('computes endTime minus startTime', () => {
    const d = sessionDurationMs({
      startTime: '2026-04-23T00:00:00Z',
      endTime: '2026-04-23T00:00:10Z',
    } as any);
    expect(d).toBe(10_000);
  });
  it('uses current time when endTime missing', () => {
    const d = sessionDurationMs({
      startTime: new Date(Date.now() - 5000).toISOString(),
    } as any);
    expect(d).toBeGreaterThanOrEqual(4900);
    expect(d).toBeLessThanOrEqual(5500);
  });
  it('returns null when no startTime', () => {
    expect(sessionDurationMs({} as any)).toBe(null);
  });
});

describe('humanDuration', () => {
  it('formats hours-minutes-seconds', () => {
    expect(humanDuration(6 * 3600_000 + 7 * 60_000 + 38_400)).toBe('6h 7m 38.4s');
  });
  it('formats minutes-seconds', () => {
    expect(humanDuration(2 * 60_000 + 500)).toBe('2m 0.5s');
  });
  it('returns em-dash for nullish', () => {
    expect(humanDuration(null)).toBe('—');
    expect(humanDuration(undefined)).toBe('—');
  });
  it('formats 0 as 0.0s', () => {
    expect(humanDuration(0)).toBe('0.0s');
  });
});

describe('shortId', () => {
  it('truncates long ids', () => {
    expect(shortId('orphan-fresh-sess-001')).toBe('orphan-fre…-001');
  });
  it('leaves short ids alone', () => {
    expect(shortId('abc')).toBe('abc');
  });
  it('handles empty input', () => {
    expect(shortId('')).toBe('');
  });
});

describe('humanizeFailureCategory', () => {
  it('snake_case to Title Case', () => {
    expect(humanizeFailureCategory('hub_restart')).toBe('Hub Restart');
    expect(humanizeFailureCategory('heartbeat_timeout')).toBe('Heartbeat Timeout');
  });
  it('returns empty string for nullish', () => {
    expect(humanizeFailureCategory(null)).toBe('');
    expect(humanizeFailureCategory(undefined)).toBe('');
  });
});
