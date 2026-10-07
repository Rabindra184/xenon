import { describe, expect, it } from 'vitest';
import { fieldDescribedBy } from '../src/renderer/src/fieldA11y';
import { clearsOnClick, segmentedItems } from '../src/renderer/src/segmentedModel';

describe('segmentedItems', () => {
  it('shows a bare string as it is', () => {
    expect(segmentedItems(['android', 'ios'])).toEqual([
      { value: 'android', label: 'android' },
      { value: 'ios', label: 'ios' }
    ]);
  });

  it('shows the label of a { value, label } option', () => {
    expect(segmentedItems([{ value: 'real', label: 'Real phones' }, 'both'])).toEqual([
      { value: 'real', label: 'Real phones' },
      { value: 'both', label: 'both' }
    ]);
  });
});

describe('clearsOnClick', () => {
  it('clears the chosen option when the control is clearable (a schema enum: unset means default)', () => {
    expect(clearsOnClick('android', 'android', true)).toBe(true);
  });

  it('keeps the chosen option when the control is not clearable (a filter, an Essentials choice)', () => {
    expect(clearsOnClick('android', 'android', false)).toBe(false);
  });

  it('never clears on a click on another option', () => {
    expect(clearsOnClick('ios', 'android', true)).toBe(false);
    expect(clearsOnClick('ios', undefined, true)).toBe(false);
  });
});

describe('fieldDescribedBy', () => {
  it('is nothing when there is nothing to describe the field', () => {
    expect(fieldDescribedBy('f', {})).toBeUndefined();
  });

  it('points at the description, then the error', () => {
    expect(fieldDescribedBy('f', { description: 'Help', error: 'Wrong' })).toBe('f-description f-error');
    expect(fieldDescribedBy('f', { error: 'Wrong' })).toBe('f-error');
    expect(fieldDescribedBy('f', { description: 'Help' })).toBe('f-description');
  });

  it('puts a unit after the box first', () => {
    expect(fieldDescribedBy('f', { description: 'Help', error: 'Wrong' }, 'f-suffix')).toBe(
      'f-suffix f-description f-error'
    );
  });
});
