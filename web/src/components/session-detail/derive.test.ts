import { describe, it, expect } from 'vitest';
import {
  firstErrorLog,
  parseStackFromReason,
  humanizeFailureCategory,
  parseCapabilities,
  humanizeCapabilityValue,
  shortSessionId,
} from './derive';

describe('firstErrorLog', () => {
  it('returns the first is_success=false entry', () => {
    const logs = [
      { is_success: true, message: 'a' },
      { is_success: false, message: 'b' },
      { is_success: false, message: 'c' },
    ];
    expect(firstErrorLog(logs)?.message).to.equal('b');
  });
  it('falls back to last entry when no explicit failure flagged', () => {
    const logs = [
      { is_success: true, message: 'a' },
      { message: 'b' },
      { message: 'c' },
    ];
    expect(firstErrorLog(logs)?.message).to.equal('c');
  });
  it('returns null for empty array', () => {
    expect(firstErrorLog([])).to.equal(null);
  });
});

describe('parseStackFromReason', () => {
  it('extracts at … frames', () => {
    const reason = `Heartbeat timeout
    at SessionManager.checkHeartbeat (session-manager.ts:142)
    at Interval.<anonymous> (session-manager.ts:88)
    at listOnTimeout (node:internal/timers:569:17)`;
    const frames = parseStackFromReason(reason);
    expect(frames).to.have.lengthOf(3);
    expect(frames[0]).to.include('SessionManager.checkHeartbeat');
  });
  it('respects max cap', () => {
    const reason = Array.from({ length: 20 }, (_, i) => `    at fn${i} (x:${i})`).join('\n');
    expect(parseStackFromReason(reason, 5)).to.have.lengthOf(5);
  });
  it('returns empty array for nullish reason', () => {
    expect(parseStackFromReason(null)).to.eql([]);
    expect(parseStackFromReason('')).to.eql([]);
  });
  it('returns empty array for reason with no at frames', () => {
    expect(parseStackFromReason('Just a plain sentence, no stack.')).to.eql([]);
  });
});

describe('humanizeFailureCategory', () => {
  it('snake_case to Title Case', () => {
    expect(humanizeFailureCategory('hub_restart')).to.equal('Hub Restart');
    expect(humanizeFailureCategory('HUB_RESTART')).to.equal('Hub Restart');
  });
  it('returns empty string for nullish', () => {
    expect(humanizeFailureCategory(null)).to.equal('');
    expect(humanizeFailureCategory(undefined)).to.equal('');
  });
});

describe('parseCapabilities', () => {
  it('parses valid JSON object', () => {
    expect(parseCapabilities('{"platformName":"Android"}')).to.eql({ platformName: 'Android' });
  });
  it('returns {} for null', () => {
    expect(parseCapabilities(null)).to.eql({});
  });
  it('returns {} for invalid JSON', () => {
    expect(parseCapabilities('{not json}')).to.eql({});
  });
  it('returns {} for non-object JSON (array)', () => {
    expect(parseCapabilities('[1,2,3]')).to.eql({});
  });
});

describe('humanizeCapabilityValue', () => {
  it('renders primitives directly', () => {
    expect(humanizeCapabilityValue('Pixel 6')).to.equal('Pixel 6');
    expect(humanizeCapabilityValue(13)).to.equal('13');
    expect(humanizeCapabilityValue(true)).to.equal('true');
  });
  it('renders objects as JSON', () => {
    expect(humanizeCapabilityValue({ a: 1 })).to.equal('{"a":1}');
  });
  it('truncates long object JSON', () => {
    const long = 'a'.repeat(300);
    const out = humanizeCapabilityValue({ s: long }, 50);
    expect(out.length).to.equal(51); // 50 chars + ellipsis
    expect(out.endsWith('…')).to.equal(true);
  });
  it('renders null as empty string', () => {
    expect(humanizeCapabilityValue(null)).to.equal('');
  });
});

describe('shortSessionId', () => {
  it('truncates long ids', () => {
    expect(shortSessionId('orphan-fresh-sess-001')).to.equal('orphan-fresh-s…-001');
  });
  it('leaves short ids alone', () => {
    expect(shortSessionId('abc')).to.equal('abc');
  });
});
