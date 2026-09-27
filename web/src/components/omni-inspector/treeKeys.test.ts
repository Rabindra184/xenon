import { describe, expect, it } from 'vitest';
import type { InspectorNode } from './OmniInspector';
import type { Row } from './treeRows';
import { treeKeyAction } from './treeKeys';

const node = (xpath: string) => ({ xpath }) as InspectorNode;
const row = (key: string, over: Partial<Row> = {}): Row => ({
  key,
  nodes: [node(key)],
  level: 1,
  setSize: 1,
  posInSet: 1,
  hasChildren: false,
  expanded: false,
  collapsible: false,
  parentKey: null,
  ...over,
});
// 0 /a (open) › 1 /a/b (closed, has children) · 2 /a/c (leaf)
const rows = [
  row('/a', {
    hasChildren: true,
    expanded: true,
    collapsible: true,
    nodes: [node('/'), node('/a')],
  }),
  row('/a/b', { level: 2, hasChildren: true, parentKey: '/a' }),
  row('/a/c', { level: 2, parentKey: '/a' }),
];

describe('treeKeyAction', () => {
  it('moves down and up, stopping at the ends', () => {
    expect(treeKeyAction(rows, 0, 'ArrowDown')).toEqual({ focus: 1 });
    expect(treeKeyAction(rows, 2, 'ArrowDown')).toBeNull();
    expect(treeKeyAction(rows, 1, 'ArrowUp')).toEqual({ focus: 0 });
    expect(treeKeyAction(rows, 0, 'ArrowUp')).toBeNull();
  });

  it('→ opens a closed row, enters an open one, and ignores a leaf', () => {
    expect(treeKeyAction(rows, 1, 'ArrowRight')).toEqual({ toggle: '/a/b' });
    expect(treeKeyAction(rows, 0, 'ArrowRight')).toEqual({ focus: 1 });
    expect(treeKeyAction(rows, 2, 'ArrowRight')).toBeNull();
  });

  it('← closes an open row, else moves to the parent; nothing at the top', () => {
    expect(treeKeyAction(rows, 0, 'ArrowLeft')).toEqual({ toggle: '/a' });
    expect(treeKeyAction(rows, 2, 'ArrowLeft')).toEqual({ focus: 0 });
    expect(treeKeyAction([row('/x')], 0, 'ArrowLeft')).toBeNull();
  });

  it('← on a row only the search holds open moves to its parent', () => {
    const held = [
      row('/a', { hasChildren: true, expanded: true, collapsible: true }),
      row('/a/b', { level: 2, hasChildren: true, expanded: true, parentKey: '/a' }),
      row('/a/b/c', { level: 3, parentKey: '/a/b' }),
    ];
    expect(treeKeyAction(held, 1, 'ArrowLeft')).toEqual({ focus: 0 });
    // → still enters it.
    expect(treeKeyAction(held, 1, 'ArrowRight')).toEqual({ focus: 2 });
  });

  it('Home and End jump to the ends', () => {
    expect(treeKeyAction(rows, 1, 'Home')).toEqual({ focus: 0 });
    expect(treeKeyAction(rows, 0, 'End')).toEqual({ focus: 2 });
  });

  it("Enter and Space select the row's target, the last node of its run", () => {
    expect(treeKeyAction(rows, 0, 'Enter')).toEqual({ select: rows[0].nodes[1] });
    expect(treeKeyAction(rows, 2, ' ')).toEqual({ select: rows[2].nodes[0] });
  });

  it('ignores other keys and a missing row', () => {
    expect(treeKeyAction(rows, 0, 'a')).toBeNull();
    expect(treeKeyAction(rows, 9, 'ArrowDown')).toBeNull();
  });
});
