import { describe, expect, it } from 'vitest';
import { draftErrorAfter, fromInput, toDisplay } from '../src/renderer/src/numberField';

describe('toDisplay', () => {
  it('shows milliseconds as minutes, to one decimal, without a trailing .0', () => {
    expect(toDisplay(300000, 'minutes-from-ms')).toBe('5');
    expect(toDisplay(90000, 'minutes-from-ms')).toBe('1.5');
    expect(toDisplay(100000, 'minutes-from-ms')).toBe('1.7');
    expect(toDisplay(0, 'minutes-from-ms')).toBe('0');
  });

  it('shows plain numbers and days as they are', () => {
    expect(toDisplay(4723, 'plain')).toBe('4723');
    expect(toDisplay(0.25, 'plain')).toBe('0.25');
    expect(toDisplay(14, 'days')).toBe('14');
  });

  it('shows an unset value as an empty field', () => {
    expect(toDisplay(undefined, 'minutes-from-ms')).toBe('');
    expect(toDisplay(undefined, 'plain')).toBe('');
    expect(toDisplay(Number.NaN, 'plain')).toBe('');
  });
});

describe('fromInput', () => {
  it('turns minutes back into milliseconds', () => {
    expect(fromInput('2.5', 'minutes-from-ms', {})).toEqual({ ok: true, value: 150000 });
    expect(fromInput('5', 'minutes-from-ms', {})).toEqual({ ok: true, value: 300000 });
    expect(fromInput(' 1.7 ', 'minutes-from-ms', {})).toEqual({ ok: true, value: 102000 });
  });

  it('keeps plain numbers and days as typed', () => {
    expect(fromInput('4723', 'plain', {})).toEqual({ ok: true, value: 4723 });
    expect(fromInput('14', 'days', {})).toEqual({ ok: true, value: 14 });
    expect(fromInput('-3', 'plain', {})).toEqual({ ok: true, value: -3 });
    expect(fromInput('.5', 'plain', {})).toEqual({ ok: true, value: 0.5 });
  });

  it('treats an empty field as unset, back to the default', () => {
    expect(fromInput('', 'minutes-from-ms', {})).toEqual({ ok: true, value: undefined });
    expect(fromInput('   ', 'plain', { min: 1 })).toEqual({ ok: true, value: undefined });
  });

  it('rejects what is not a number', () => {
    for (const text of ['abc', '1.2.3', '0x10', '1e3', 'Infinity', '--1', '5 min']) {
      expect(fromInput(text, 'plain', {}), text).toEqual({ ok: false, error: 'Enter a number.' });
    }
  });

  it('applies the bounds to the number shown, not to the stored value', () => {
    expect(fromInput('0', 'plain', { min: 1 })).toEqual({ ok: false, error: 'Enter 1 or more.' });
    expect(fromInput('1', 'plain', { min: 1 })).toEqual({ ok: true, value: 1 });
    expect(fromInput('101', 'plain', { max: 100 })).toEqual({ ok: false, error: 'Enter 100 or less.' });
    expect(fromInput('100', 'plain', { max: 100 })).toEqual({ ok: true, value: 100 });
    expect(fromInput('0.5', 'minutes-from-ms', { min: 1 })).toEqual({ ok: false, error: 'Enter 1 or more.' });
    expect(fromInput('61', 'minutes-from-ms', { max: 60 })).toEqual({ ok: false, error: 'Enter 60 or less.' });
    expect(fromInput('60', 'minutes-from-ms', { max: 60 })).toEqual({ ok: true, value: 3600000 });
  });

  it('requires a whole number when asked', () => {
    expect(fromInput('1.5', 'plain', { integer: true })).toEqual({ ok: false, error: 'Enter a whole number.' });
    expect(fromInput('2', 'plain', { integer: true })).toEqual({ ok: true, value: 2 });
    expect(fromInput('2.0', 'plain', { integer: true })).toEqual({ ok: true, value: 2 });
  });

  it('reports a whole-number problem before a range problem', () => {
    expect(fromInput('0.5', 'plain', { integer: true, min: 1 })).toEqual({ ok: false, error: 'Enter a whole number.' });
  });
});

describe('draftErrorAfter (Task 17 minor: errors on blur or Enter)', () => {
  const invalid = fromInput('0', 'minutes-from-ms', { min: 0.5 });
  const valid = fromInput('0.5', 'minutes-from-ms', { min: 0.5 });

  it('shows no error while typing, on the way to a valid number', () => {
    expect(invalid.ok).toBe(false);
    expect(draftErrorAfter('change', undefined, invalid)).toBeUndefined();
  });

  it('shows the text’s error when the box is left or Enter is pressed', () => {
    expect(draftErrorAfter('settle', undefined, invalid)).toBe('Enter 0.5 or more.');
  });

  it('clears a shown error as soon as the text is valid, while typing', () => {
    expect(draftErrorAfter('change', 'Enter 0.5 or more.', valid)).toBeUndefined();
    expect(draftErrorAfter('settle', 'Enter 0.5 or more.', valid)).toBeUndefined();
  });

  it('leaves a shown error as it is while the text stays invalid, so nothing new is announced mid-typing', () => {
    expect(draftErrorAfter('change', 'Enter 0.5 or more.', fromInput('1e', 'plain', {}))).toBe('Enter 0.5 or more.');
  });
});

