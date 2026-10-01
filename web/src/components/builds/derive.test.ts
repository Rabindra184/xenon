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
  appFromCapabilities,
  sessionDisplayName,
  buildDisplayName,
  sinceFor,
  compactDuration,
  formatStartTime,
  passRate,
  passRateDelta,
  ranOnLabel,
  failedTestsReport,
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

describe('appFromCapabilities', () => {
  it('prefers the package or bundle id the driver resolved', () => {
    expect(
      appFromCapabilities('{"appium:appPackage":"com.android.settings","appium:app":"/tmp/x.apk"}'),
    ).toBe('com.android.settings');
    expect(appFromCapabilities('{"bundleId":"com.apple.Preferences"}')).toBe(
      'com.apple.Preferences',
    );
  });
  it('names an app file by its file name, without the path or query', () => {
    expect(appFromCapabilities('{"appium:app":"/Users/ci/builds/checkout-1.4.2.apk"}')).toBe(
      'checkout-1.4.2.apk',
    );
    expect(
      appFromCapabilities('{"appium:app":"https://cdn.example.com/a/Shop.ipa?sig=abc#x"}'),
    ).toBe('Shop.ipa');
    expect(appFromCapabilities('{"appium:app":"C:\\\\apps\\\\Shop.apk"}')).toBe('Shop.apk');
  });
  it("ignores a library app's download URL, which names no app", () => {
    expect(
      appFromCapabilities('{"appium:app":"http://hub:4723/xenon/api/apps/a-1/download"}'),
    ).toBe(null);
  });
  it('reads W3C capabilities too', () => {
    expect(
      appFromCapabilities(
        '{"alwaysMatch":{"platformName":"iOS"},"firstMatch":[{"appium:bundleId":"com.x.y"}]}',
      ),
    ).toBe('com.x.y');
    expect(
      appFromCapabilities('{"capabilities":{"alwaysMatch":{"appium:appPackage":"com.a"}}}'),
    ).toBe('com.a');
  });
  it('falls back to a browser name', () => {
    expect(appFromCapabilities('{"browserName":"Chrome"}')).toBe('Chrome');
  });
  it('returns null for nothing, or for what is not JSON', () => {
    expect(appFromCapabilities('{}')).toBe(null);
    expect(appFromCapabilities('not json')).toBe(null);
    expect(appFromCapabilities(null)).toBe(null);
  });
});

describe('sessionDisplayName', () => {
  const base = { id: '088cce7e-1234-5678', desired_capabilities: '{}', session_capabilities: '{}' };
  it("uses the test's own name first", () => {
    expect(sessionDisplayName({ ...base, name: '  Login with saved card ' } as any)).toEqual({
      text: 'Login with saved card',
      source: 'name',
    });
  });
  it('then the app, from what the session ran with before what was asked for', () => {
    expect(
      sessionDisplayName({
        ...base,
        name: '',
        desired_capabilities: '{"appium:app":"/tmp/shop.apk"}',
        session_capabilities: '{"appium:appPackage":"com.example.shop"}',
      } as any),
    ).toEqual({ text: 'com.example.shop', source: 'app' });
    expect(
      sessionDisplayName({
        ...base,
        desired_capabilities: '{"appium:app":"/tmp/shop.apk"}',
      } as any),
    ).toEqual({ text: 'shop.apk', source: 'app' });
  });
  it('then a short id', () => {
    expect(sessionDisplayName(base as any)).toEqual({ text: 'Session 088cce7e', source: 'id' });
  });
});

describe('buildDisplayName', () => {
  const at = new Date(2026, 8, 29, 7, 30).toISOString();
  it("uses the build's name", () => {
    expect(buildDisplayName({ name: 'Nightly smoke', createdAt: at })).toBe('Nightly smoke');
  });
  it('names an unnamed build, or the default one, by when it started', () => {
    expect(buildDisplayName({ name: 'Default Build', createdAt: at })).toBe(
      'Build · Sep 29, 07:30',
    );
    expect(buildDisplayName({ name: '  ', createdAt: at })).toBe('Build · Sep 29, 07:30');
    expect(buildDisplayName({ name: null, createdAt: at })).toBe('Build · Sep 29, 07:30');
  });
});

describe('sinceFor', () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  it('is the start of the chosen period', () => {
    expect(sinceFor('24h', now)).toBe('2026-09-30T12:00:00.000Z');
    expect(sinceFor('7d', now)).toBe('2026-09-24T12:00:00.000Z');
    expect(sinceFor('30d', now)).toBe('2026-09-01T12:00:00.000Z');
  });
  it('is null for all time', () => {
    expect(sinceFor('all', now)).toBe(null);
  });
});

describe('compactDuration', () => {
  it('drops the decimals people do not read', () => {
    expect(compactDuration(26_400)).toBe('26s');
    expect(compactDuration(130_000)).toBe('2m 10s');
    expect(compactDuration(60_000)).toBe('1m 0s');
    expect(compactDuration(3_725_000)).toBe('1h 2m');
  });
  it('says under a second rather than 0s', () => {
    expect(compactDuration(400)).toBe('<1s');
  });
  it('is a dash for nothing', () => {
    expect(compactDuration(null)).toBe('—');
    expect(compactDuration(-5)).toBe('—');
  });
});

describe('formatStartTime', () => {
  const now = new Date(2026, 8, 30, 21, 0);
  it('is the time alone for today', () => {
    expect(formatStartTime(new Date(2026, 8, 30, 20, 41).toISOString(), now)).toBe('20:41');
  });
  it('adds the date for another day this year', () => {
    expect(formatStartTime(new Date(2026, 8, 29, 7, 5).toISOString(), now)).toBe('Sep 29, 07:05');
  });
  it('adds the year for another year', () => {
    expect(formatStartTime(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe(
      'Dec 31, 2025 23:59',
    );
  });
  it('is a dash for nothing', () => {
    expect(formatStartTime(null, now)).toBe('—');
    expect(formatStartTime('garbage', now)).toBe('—');
  });
});

describe('passRate', () => {
  it('is the share of sessions with a verdict that passed', () => {
    expect(passRate({ passed: 18, failed: 3 })).toBeCloseTo(85.71, 1);
  });
  it('is null with no verdicts to rate', () => {
    expect(passRate({ passed: 0, failed: 0 })).toBe(null);
  });
});

describe('passRateDelta', () => {
  it('is the change in points from the period before', () => {
    expect(passRateDelta({ passed: 9, failed: 1 }, { passed: 8, failed: 2 })).toBeCloseTo(10, 5);
    expect(passRateDelta({ passed: 1, failed: 1 }, { passed: 3, failed: 1 })).toBeCloseTo(-25, 5);
  });
  it('is null when either period has nothing to rate', () => {
    expect(passRateDelta({ passed: 1, failed: 0 }, null)).toBe(null);
    expect(passRateDelta({ passed: 1, failed: 0 }, { passed: 0, failed: 0 })).toBe(null);
    expect(passRateDelta({ passed: 0, failed: 0 }, { passed: 1, failed: 0 })).toBe(null);
  });
});

describe('ranOnLabel', () => {
  it('names this server, or the node by its host', () => {
    expect(ranOnLabel('here')).toBe('This server');
    expect(ranOnLabel('10.0.0.9:4725')).toBe('10.0.0.9:4725');
    expect(ranOnLabel(null)).toBe(null);
    expect(ranOnLabel(undefined)).toBe(null);
  });
});

describe('filterSessions search', () => {
  const s = {
    id: 'abc',
    status: 'failed',
    desired_capabilities: '{"appium:appPackage":"com.example.shop"}',
    session_capabilities: '{}',
    failure_reason: 'NoSuchElement: checkout_button',
    owner: { name: 'Priya Shah', email: 'priya@example.com' },
    ranOn: '10.0.0.9:4725',
  } as any;
  it('finds a session by what its row shows', () => {
    for (const q of ['shop', 'checkout_button', 'priya', 'example.com', '10.0.0.9']) {
      expect(filterSessions([s], 'all', q), q).toHaveLength(1);
    }
    expect(filterSessions([s], 'all', 'nothing-like-it')).toHaveLength(0);
  });
});

describe('failedTestsReport', () => {
  const s = (over: Record<string, unknown>) =>
    ({
      id: 'x',
      status: 'success',
      name: 'A test',
      desired_capabilities: '{}',
      session_capabilities: '{}',
      device_name: 'Galaxy S9+',
      device_platform: 'android',
      device_version: '10',
      ...over,
    }) as any;
  // As GET /session lists them: newest first.
  const sessions = [
    s({
      id: 's-4',
      name: 'Sign out',
      status: 'timeout',
      failure_reason: 'Session timed out after 60 s\nat x',
    }),
    s({ id: 's-3', name: 'Checkout', status: 'success' }),
    s({
      id: 's-2',
      name: null,
      status: 'error',
      failure_reason: null,
      device_name: 'iPhone 15',
      device_platform: 'ios',
      device_version: '26.0',
      session_capabilities: '{"appium:bundleId":"com.example.shop"}',
    }),
    s({
      id: 's-1',
      name: 'Apply coupon',
      status: 'failed',
      failure_reason: 'AssertionError: expected 10%',
    }),
  ];

  it("lists the build's failed tests, oldest first, with why, where and which session", () => {
    expect(failedTestsReport('Nightly smoke', sessions)).toEqual({
      count: 3,
      text: [
        'Failed tests in Nightly smoke: 3 of 4 sessions',
        '',
        '- Apply coupon',
        '  AssertionError: expected 10%',
        '  Galaxy S9+ · Android 10 · session s-1',
        '- com.example.shop',
        '  No reason recorded',
        '  iPhone 15 · iOS 26.0 · session s-2',
        '- Sign out',
        '  Session timed out after 60 s',
        '  Galaxy S9+ · Android 10 · session s-4',
      ].join('\n'),
    });
  });

  it('keeps to the selected sessions when some are selected', () => {
    const out = failedTestsReport('Nightly smoke', sessions, new Set(['s-3', 's-4']));
    expect(out.count).toBe(1);
    expect(out.text.split('\n')[0]).toBe('Failed tests in Nightly smoke: 1 of 2 selected sessions');
    expect(out.text).toContain('- Sign out');
    expect(out.text).not.toContain('Apply coupon');
  });

  it('has nothing to copy when nothing failed', () => {
    expect(failedTestsReport('Nightly smoke', [sessions[1]])).toEqual({ count: 0, text: '' });
  });
});
