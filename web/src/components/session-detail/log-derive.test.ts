import { describe, it, expect } from 'vitest';
import {
  logTimestamp,
  logRowKind,
  logInlinePreview,
  prettyJson,
  tokenizeJson,
  filterErrorsOnly,
  logDisplayTitle,
  logDisplaySubtitle,
} from './log-derive';

describe('logTimestamp', () => {
  it('formats ISO string as HH:MM:SS', () => {
    const out = logTimestamp({ timestamp: '2026-04-23T08:31:42Z' });
    expect(out).to.match(/^\d{2}:\d{2}:42$/);
  });
  it('falls back to createdAt when no timestamp', () => {
    const out = logTimestamp({ createdAt: '2026-04-23T08:31:42Z' } as any);
    expect(out).to.match(/^\d{2}:\d{2}:42$/);
  });
  it('returns dashes for invalid input', () => {
    expect(logTimestamp({ timestamp: 'not a date' })).to.equal('--:--:--');
    expect(logTimestamp({})).to.equal('--:--:--');
  });
});

describe('logRowKind', () => {
  it('marks healed rows amber', () => {
    expect(logRowKind({ healed: true } as any).tone).to.equal('amber');
  });
  it('marks failed rows red', () => {
    expect(logRowKind({ is_success: false, command_name: 'click' }).tone).to.equal('red');
    expect(logRowKind({ is_success: false, command_name: 'click' }).label).to.equal('click');
  });
  it('marks successful rows green', () => {
    expect(logRowKind({ is_success: true, command_name: 'tap' }).tone).to.equal('green');
  });
  it('infers from event/title — stop=red, start=green', () => {
    expect(logRowKind({ title: 'session_stopped' } as any).tone).to.equal('red');
    expect(logRowKind({ event: 'session_started' } as any).tone).to.equal('green');
    expect(logRowKind({ command_name: 'init' } as any).tone).to.equal('green');
  });
  it('falls back to neutral with label "log"', () => {
    expect(logRowKind({}).tone).to.equal('neutral');
    expect(logRowKind({}).label).to.equal('log');
  });
});

describe('logInlinePreview', () => {
  it('uses .body string when present', () => {
    const out = logInlinePreview({ body: 'hello world' } as any);
    expect(out).to.equal('hello world');
  });
  it('JSON-stringifies object .body', () => {
    const out = logInlinePreview({ body: { a: 1 } } as any);
    expect(out).to.equal('{"a":1}');
  });
  it('falls back to whole entry JSON', () => {
    const out = logInlinePreview({ id: 'x', message: 'hi' } as any);
    expect(out).to.contain('"id":"x"');
  });
  it('truncates long output with ellipsis', () => {
    const out = logInlinePreview({ body: 'x'.repeat(500) } as any, 50);
    expect(out.endsWith('…')).to.equal(true);
    expect(out.length).to.equal(51);
  });
});

describe('prettyJson', () => {
  it('returns "" for nullish', () => {
    expect(prettyJson(null)).to.equal('');
    expect(prettyJson(undefined)).to.equal('');
  });
  it('round-trips a JSON string', () => {
    expect(prettyJson('{"a":1}')).to.equal('{\n  "a": 1\n}');
  });
  it('returns plain string when not JSON', () => {
    expect(prettyJson('just a string')).to.equal('just a string');
  });
  it('formats objects', () => {
    expect(prettyJson({ a: 1 })).to.equal('{\n  "a": 1\n}');
  });
});

describe('tokenizeJson', () => {
  it('classifies keys vs string values', () => {
    const t = tokenizeJson('{"a":"b"}');
    const kinds = t.map((x) => x.kind);
    // We expect: punct({), key("a"), punct(:), string("b"), punct(})
    expect(kinds).to.contain('key');
    expect(kinds).to.contain('string');
    expect(kinds).to.contain('punct');
  });
  it('classifies numbers, booleans, null', () => {
    const t = tokenizeJson('{"n":1,"b":true,"u":null}');
    const kinds = t.map((x) => x.kind);
    expect(kinds).to.contain('number');
    expect(kinds).to.contain('boolean');
    expect(kinds).to.contain('null');
  });
  it('handles empty/non-string input gracefully', () => {
    expect(tokenizeJson('')).to.eql([{ text: '', kind: 'plain' }]);
    expect(tokenizeJson(null as any)[0].kind).to.equal('plain');
  });
});

describe('filterErrorsOnly', () => {
  it('passes through when off', () => {
    const logs = [{ is_success: true }, { is_success: false }] as any;
    expect(filterErrorsOnly(logs, false)).to.have.lengthOf(2);
  });
  it('keeps only is_success=false rows when on', () => {
    const logs = [{ is_success: true }, { is_success: false }, {}] as any;
    expect(filterErrorsOnly(logs, true)).to.have.lengthOf(1);
  });
});

describe('log display derivation', () => {
  const dbRow = {
    id: 'slog-3',
    session_id: 'sess-audit-2',
    command_name: 'findElement',
    title: 'Find Element',
    subtitle: 'accessibility id: btn_place_order',
    response: '{"error":"no such element"}',
  };

  it('prefers title over raw JSON', () => {
    expect(logDisplayTitle(dbRow as any)).toBe('Find Element');
  });

  it('falls back to command_name then a generic label', () => {
    expect(logDisplayTitle({ command_name: 'click' } as any)).toBe('click');
    expect(logDisplayTitle({} as any)).toBe('Command');
  });

  it('exposes the subtitle when present', () => {
    expect(logDisplaySubtitle(dbRow as any)).toBe('accessibility id: btn_place_order');
    expect(logDisplaySubtitle({} as any)).toBeNull();
  });
});
