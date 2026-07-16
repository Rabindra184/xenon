import { describe, expect, it } from 'vitest';
import { parsePort } from '../src/renderer/src/validation';

describe('parsePort', () => {
  it('accepts a valid port', () => {
    expect(parsePort('4723')).toEqual({ ok: true, value: 4723 });
    expect(parsePort(' 8080 ')).toEqual({ ok: true, value: 8080 });
  });

  it('rejects an empty field with a required message', () => {
    const res = parsePort('');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/required/i);
  });

  it('rejects non-numeric and non-integer input rather than producing NaN', () => {
    expect(parsePort('abc').ok).toBe(false);
    expect(parsePort('47.5').ok).toBe(false);
  });

  it('rejects out-of-range ports', () => {
    expect(parsePort('0').ok).toBe(false);
    expect(parsePort('70000').ok).toBe(false);
    expect(parsePort('65535')).toEqual({ ok: true, value: 65535 });
    expect(parsePort('1')).toEqual({ ok: true, value: 1 });
  });
});
