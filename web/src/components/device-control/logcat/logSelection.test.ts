import { describe, expect, it } from 'vitest';
import { formatLine } from './logcatRecording';
import { NO_SELECTION, clickSelection, moveSelection, selectedLines } from './logSelection';

const order = [10, 11, 12, 13, 14];
const plain = { range: false, toggle: false };
const seqs = (s: { selected: ReadonlySet<number> }) => Array.from(s.selected).sort((a, b) => a - b);
const rec = (seq: number) => ({
  seq,
  ts: Date.UTC(2026, 9, 3, 10, 0, seq),
  pid: 7,
  level: 'I',
  tag: 'T',
  message: `m${seq}`,
});

describe('clickSelection', () => {
  it('a plain click selects one line and makes it the anchor and the active line', () => {
    const s = clickSelection(NO_SELECTION, 12, order, plain);
    expect(seqs(s)).toEqual([12]);
    expect(s.anchor).toBe(12);
    expect(s.active).toBe(12);
  });

  it('Cmd or Ctrl adds a line, and removes it the second time', () => {
    let s = clickSelection(NO_SELECTION, 11, order, plain);
    s = clickSelection(s, 13, order, { range: false, toggle: true });
    expect(seqs(s)).toEqual([11, 13]);
    s = clickSelection(s, 11, order, { range: false, toggle: true });
    expect(seqs(s)).toEqual([13]);
  });

  it('Shift selects the run between the anchor and the line, in list order', () => {
    let s = clickSelection(NO_SELECTION, 11, order, plain);
    s = clickSelection(s, 13, order, { range: true, toggle: false });
    expect(seqs(s)).toEqual([11, 12, 13]);
    s = clickSelection(s, 10, order, { range: true, toggle: false });
    expect(seqs(s)).toEqual([10, 11]);
    expect(s.anchor).toBe(11);
  });

  it('Shift with no anchor on screen selects just that line', () => {
    const s = clickSelection({ selected: new Set([99]), anchor: 99, active: 99 }, 12, order, {
      range: true,
      toggle: false,
    });
    expect(seqs(s)).toEqual([12]);
  });

  // The buffer drops its oldest lines; seqs don't move, so a range still works.
  it('still selects a range after the oldest lines were dropped', () => {
    const s = clickSelection(NO_SELECTION, 12, order, plain);
    expect(seqs(clickSelection(s, 14, [12, 13, 14, 15], { range: true, toggle: false }))).toEqual([
      12, 13, 14,
    ]);
  });
});

describe('moveSelection', () => {
  it('starts at the first line going down and the last going up', () => {
    expect(moveSelection(NO_SELECTION, order, 1, false).active).toBe(10);
    expect(moveSelection(NO_SELECTION, order, -1, false).active).toBe(14);
  });

  it('steps the active line and selects only it, clamped at the ends', () => {
    let s = clickSelection(NO_SELECTION, 13, order, plain);
    s = moveSelection(s, order, 1, false);
    expect(seqs(s)).toEqual([14]);
    expect(moveSelection(s, order, 1, false).active).toBe(14);
  });

  it('with Shift, grows the run from the anchor', () => {
    let s = clickSelection(NO_SELECTION, 11, order, plain);
    s = moveSelection(s, order, 1, true);
    s = moveSelection(s, order, 1, true);
    expect(seqs(s)).toEqual([11, 12, 13]);
    expect(s.active).toBe(13);
    expect(s.anchor).toBe(11);
  });
});

describe('selectedLines', () => {
  it('copies the selected lines in list order, as Export writes them', () => {
    const shown = [rec(1), rec(2), rec(3)];
    expect(selectedLines(shown, new Set([3, 1]))).toEqual({
      text: `${formatLine(shown[0])}\n${formatLine(shown[2])}`,
      count: 2,
    });
  });

  it('leaves out selected lines the filter hides', () => {
    expect(selectedLines([rec(1)], new Set([1, 2])).count).toBe(1);
  });
});
