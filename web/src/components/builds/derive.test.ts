import { describe, it, expect } from 'vitest';
import {
  buildStatusCounts,
  sessionStatusBucket,
  filterSessions,
  deviceNameOrFallback,
  platformLabel,
  osVersionLabel,
  formatAbsoluteTime,
  sessionDurationMs,
  humanDuration,
  shortId,
  humanizeFailureCategory,
} from './derive';

describe('sessionStatusBucket', () => {
  // The canonical backend value is 'success' — this is the case the old
  // 'ended'|'passed'-only logic missed, hiding every passed session under the
  // Passed filter.
  it('buckets the canonical success status as passed', () => {
    expect(sessionStatusBucket('success')).toBe('passed');
  });
  it('treats ended/passed aliases as passed', () => {
    expect(sessionStatusBucket('ended')).toBe('passed');
    expect(sessionStatusBucket('passed')).toBe('passed');
  });
  it('buckets failed, error and timeout as failed', () => {
    expect(sessionStatusBucket('failed')).toBe('failed');
    expect(sessionStatusBucket('error')).toBe('failed');
    expect(sessionStatusBucket('timeout')).toBe('failed');
  });
  it('buckets running as running', () => {
    expect(sessionStatusBucket('running')).toBe('running');
  });
  it('buckets unmarked / unknown / nullish as other', () => {
    expect(sessionStatusBucket('unmarked')).toBe('other');
    expect(sessionStatusBucket('weird')).toBe('other');
    expect(sessionStatusBucket(null)).toBe('other');
    expect(sessionStatusBucket(undefined)).toBe('other');
  });
});

describe('buildStatusCounts', () => {
  it('counts passed/failed/running across canonical statuses', () => {
    const s = [
      { status: 'success' },
      { status: 'success' },
      { status: 'failed' },
      { status: 'running' },
    ] as any;
    expect(buildStatusCounts(s)).toEqual({ all: 4, passed: 2, failed: 1, running: 1 });
  });

  it('counts success sessions as passed (regression: Passed filter was empty)', () => {
    expect(buildStatusCounts([{ status: 'success' }] as any)).toEqual({
      all: 1, passed: 1, failed: 0, running: 0,
    });
  });

  it('treats "passed"/"ended" aliases as passed', () => {
    expect(buildStatusCounts([{ status: 'passed' }, { status: 'ended' }] as any)).toEqual({
      all: 2, passed: 2, failed: 0, running: 0,
    });
  });

  it('counts unmarked sessions under all only, not any verdict bucket', () => {
    expect(buildStatusCounts([{ status: 'unmarked' }, { status: 'success' }] as any)).toEqual({
      all: 2, passed: 1, failed: 0, running: 0,
    });
  });

  it('handles empty array', () => {
    expect(buildStatusCounts([])).toEqual({ all: 0, passed: 0, failed: 0, running: 0 });
  });
});

describe('filterSessions', () => {
  const sessions = [
    { id: 's1', status: 'success', device_name: 'Pixel 7', device_platform: 'android' },
    { id: 's2', status: 'success', device_name: 'iPhone 15', device_platform: 'ios' },
    { id: 's3', status: 'failed', device_name: 'Pixel 7', device_platform: 'android' },
  ] as any;

  it('returns all sessions for the "all" filter with no search', () => {
    expect(filterSessions(sessions, 'all', '').length).toBe(3);
  });

  it('filters by status bucket (success counts as passed)', () => {
    expect(filterSessions(sessions, 'passed', '').map((s) => s.id)).toEqual(['s1', 's2']);
    expect(filterSessions(sessions, 'failed', '').map((s) => s.id)).toEqual(['s3']);
  });

  it('matches the count the "X of Y" label should show under a filter (regression)', () => {
    // Was: label showed total (3) regardless of filter. Now: matches filtered rows.
    expect(filterSessions(sessions, 'passed', '').length).toBe(2);
    expect(filterSessions(sessions, 'running', '').length).toBe(0);
  });

  it('applies free-text search across id/name/platform, case-insensitively', () => {
    expect(filterSessions(sessions, 'all', 'iphone').map((s) => s.id)).toEqual(['s2']);
    expect(filterSessions(sessions, 'all', 'android').length).toBe(2);
    expect(filterSessions(sessions, 'all', 's3').map((s) => s.id)).toEqual(['s3']);
  });

  it('combines status filter and search (both must match)', () => {
    expect(filterSessions(sessions, 'passed', 'pixel').map((s) => s.id)).toEqual(['s1']);
    expect(filterSessions(sessions, 'failed', 'iphone').length).toBe(0);
  });

  it('trims/ignores whitespace-only search', () => {
    expect(filterSessions(sessions, 'all', '   ').length).toBe(3);
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
  it('formats ISO string to MMM d, HH:mm:ss', () => {
    const out = formatAbsoluteTime('2026-04-23T06:53:25Z');
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}:\d{2}$/);
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
