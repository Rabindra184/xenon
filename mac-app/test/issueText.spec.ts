import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundMessage, essentialsIssueMessage, issueMessage, listedIssueMessage } from '../src/renderer/src/issueText';
import { fromInput } from '../src/renderer/src/numberField';
import { blockedReason, decideStart } from '../src/renderer/src/readiness';
import { validate } from '../src/renderer/src/validation';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
import type { Profile, ValidationIssue, XenonSchema } from '../src/shared/types';
import { findJargon } from './e2e/jargon';

// Round 2: a bound is said in the unit of the box it is shown under, and a problem is named in plain
// words wherever it is named (Home, the sidebar, Settings).

const schema = JSON.parse(readFileSync(resolve(__dirname, '..', 'resources', 'schema.json'), 'utf8')) as XenonSchema;
const schemaKeys = Object.keys(schema.properties);

/** A 0.2.0 profile holding settings no box would now let through. */
const holding = (settings: Record<string, unknown>): Profile => {
  const base = makeDefaultProfile({ id: 'p1', now: 0 });
  return { ...base, settings: { ...base.settings, ...settings } };
};
const issueFor = (settings: Record<string, unknown>, path: string): ValidationIssue =>
  validate(schema, holding(settings)).find((i) => i.path === path)!;

describe('boundMessage', () => {
  it('says a bound in the unit of the box, in the number box’s own words', () => {
    expect(boundMessage({ min: 30000 }, 'minutes-from-ms')).toBe('Enter 0.5 or more.');
    expect(boundMessage({ min: 30000 }, 'plain')).toBe('Enter 30000 or more.');
    expect(boundMessage({ min: 1 }, 'days')).toBe('Enter 1 or more.');
    expect(boundMessage({ max: 65535 }, 'plain')).toBe('Enter 65535 or less.');
  });

  it('adds the unit’s word after the number, for a line away from the box', () => {
    expect(boundMessage({ min: 30000 }, 'minutes-from-ms', 'min')).toBe('Enter 0.5 min or more.');
  });
});

describe('the probe: a 0.2.0 profile waiting 10000 ms for a free phone', () => {
  const issue = issueFor({ deviceAvailabilityTimeoutMs: 10000 }, 'deviceAvailabilityTimeoutMs');

  it('carries the bound in milliseconds, and says it in milliseconds for All settings', () => {
    expect(issue.bound).toEqual({ min: 30000 });
    expect(issue.message).toBe('Enter 30000 or more.');
    expect(issueMessage(issue)).toBe('Enter 30000 or more.');
  });

  it('says it in minutes under Essentials’ box, and the number it asks for stores the bound', () => {
    const message = essentialsIssueMessage(issue);
    expect(message).toBe('Enter 0.5 or more.');
    // Typing what the message asks for, in that box's unit, stores 30000 ms, not 1,800,000,000.
    expect(fromInput('0.5', 'minutes-from-ms', { min: 0.5 })).toEqual({ ok: true, value: 30000 });
  });

  it('says it in minutes, with the unit, in Settings’ list of problems, which names it as Essentials does', () => {
    expect(issue.label).toBe('Wait for a free phone up to');
    expect(listedIssueMessage(issue)).toBe('Enter 0.5 min or more.');
  });

  it('is named in plain words on Home and in the sidebar', () => {
    const decision = decideStart({ status: 'stopped', issues: [issue], readiness: null, checking: false, installing: false });
    const sentence = blockedReason(decision);
    expect(sentence).toBe('Fix 1 setting first: Wait for a free phone up to');
    expect(findJargon(sentence!, schemaKeys)).toEqual([]);
  });
});

describe('every other bound', () => {
  it('keeps its stored unit where Essentials shows the same number (days) or no box at all', () => {
    const days = issueFor({ buildCleanupDays: 0 }, 'buildCleanupDays');
    expect([days.label, essentialsIssueMessage(days), listedIssueMessage(days)]).toEqual(['Keep history for', 'Enter 1 or more.', 'Enter 1 or more.']);
    const count = issueFor({ recordingCleanupMaxCount: 0 }, 'recordingCleanupMaxCount');
    expect([count.label, essentialsIssueMessage(count), listedIssueMessage(count)]).toEqual([
      'Most live recordings to keep',
      'Enter 1 or more.',
      'Enter 1 or more.'
    ]);
    const above = issueFor({ maxConcurrentRecordings: 40 }, 'maxConcurrentRecordings');
    expect([above.label, above.message, above.bound]).toEqual(['Live recordings at the same time', 'Enter 16 or less.', { max: 16 }]);
  });

  it('leaves a problem that is not a bound as it is, wherever it is said', () => {
    const hub = issueFor({ hub: 'http://hub-mac:4723/wd/hub' }, 'hub');
    expect(hub.bound).toBeUndefined();
    expect(essentialsIssueMessage(hub)).toBe(hub.message);
    expect(listedIssueMessage(hub)).toBe(hub.message);
  });
});

describe('plain names for every problem (Home, the sidebar and Settings)', () => {
  it('names each option as the catalog does, never by the schema’s raw label', () => {
    const issues = validate(
      schema,
      holding({
        deviceAvailabilityTimeoutMs: 10000,
        buildCleanupDays: 0,
        maxConcurrentRecordings: 0,
        hub: 'http://u:p@hub-mac:4723',
        healthCheckIntervalMs: 'often'
      })
    );
    expect(Object.fromEntries(issues.map((i) => [i.path, i.label]))).toEqual({
      deviceAvailabilityTimeoutMs: 'Wait for a free phone up to',
      buildCleanupDays: 'Keep history for',
      maxConcurrentRecordings: 'Live recordings at the same time',
      healthCheckIntervalMs: 'How often to check phones',
      hub: 'Hub address'
    });
    for (const issue of issues) {
      expect(findJargon(blockedReason({ ok: false, kind: 'invalid', issue, count: 1 })!, schemaKeys), issue.path).toEqual([]);
      expect(issue.label, issue.path).not.toMatch(/\(ms\)|Device Availability|Build Cleanup/);
    }
  });

  it('names an option the catalog has never heard of in sentence case', () => {
    const newer: XenonSchema = { ...schema, properties: { ...schema.properties, waitBeforeRetryMs: { type: 'number', minimum: 10 } } };
    const [issue] = validate(newer, holding({ waitBeforeRetryMs: 1 })).filter((i) => i.path === 'waitBeforeRetryMs');
    expect(issue.label).toBe('Wait before retry ms');
    expect(issue.message).toBe('Enter 10 or more.');
  });
});
