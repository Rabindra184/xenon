import { describe, expect, it } from 'vitest';
import { addChip, removeChip, rowsToValue } from '../src/renderer/src/editorModel';

describe('editorModel', () => {
  it('addChip trims, dedupes and ignores empty input', () => {
    expect(addChip([], '  device-1  ')).toEqual(['device-1']);
    expect(addChip(['a'], 'a')).toEqual(['a']);
    expect(addChip(['a'], '   ')).toEqual(['a']);
  });

  it('removeChip removes by index', () => {
    expect(removeChip(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('rowsToValue drops all-empty rows and returns undefined when nothing remains', () => {
    expect(rowsToValue([{ name: 'iPhone 15', sdk: '17.0' }, { name: '', sdk: '' }])).toEqual([
      { name: 'iPhone 15', sdk: '17.0' }
    ]);
    expect(rowsToValue([{ name: '', sdk: '' }])).toBeUndefined();
    expect(rowsToValue([])).toBeUndefined();
  });

  it('rowsToValue keeps partially-filled rows', () => {
    expect(rowsToValue([{ name: 'iPhone 15', sdk: '' }])).toEqual([{ name: 'iPhone 15', sdk: '' }]);
  });
});
