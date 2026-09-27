import { describe, expect, it } from 'vitest';
import type { InspectorNode } from './OmniInspector';
import {
  foldRun,
  initialExpanded,
  isPlainWrapper,
  matchSet,
  nodeTooltip,
  pathTo,
  rowIndexOf,
  shortName,
  shortResourceId,
  visibleRows,
} from './treeRows';

function el(
  xpath: string,
  over: Partial<InspectorNode> = {},
  children: InspectorNode[] = [],
): InspectorNode {
  return {
    name: '',
    type: 'android.widget.FrameLayout',
    rect: { x: 0, y: 0, width: 100, height: 100 },
    xpath,
    suggestedLocators: [],
    suggestedActions: [],
    attributes: {},
    children,
    ...over,
  };
}
const btn = (xpath: string, text = 'OK') =>
  el(xpath, { type: 'android.widget.Button', text, attributes: { clickable: 'true' } });

describe('names', () => {
  it('drops the package from a resource id', () => {
    expect(shortResourceId('com.sec.android.app.launcher:id/scrim_view')).toBe('scrim_view');
    expect(shortResourceId('android:id/content')).toBe('content');
    expect(shortResourceId('plain')).toBe('plain');
    expect(shortResourceId(undefined)).toBe('');
  });

  it('describes a node for a tooltip: full type, resource id and text, one per line', () => {
    const b = el('/b', {
      type: 'android.widget.Button',
      text: 'Sign in',
      attributes: { 'resource-id': 'com.app:id/login' },
    });
    expect(nodeTooltip(b)).toBe('android.widget.Button\ncom.app:id/login\nSign in');
    expect(nodeTooltip(el('/a', { text: '  ' }))).toBe('android.widget.FrameLayout');
  });

  it('names a node by text, content-desc, label, id, iOS name, then type', () => {
    const a = { 'content-desc': 'Close', 'resource-id': 'app:id/x', name: 'ios-id' };
    expect(shortName(el('/a', { text: 'Hi', attributes: a }))).toBe('Hi');
    expect(shortName(el('/a', { attributes: a }))).toBe('Close');
    expect(shortName(el('/a', { attributes: { label: 'Done', 'resource-id': 'app:id/x' } }))).toBe(
      'Done',
    );
    expect(shortName(el('/a', { attributes: { 'resource-id': 'app:id/x', name: 'n' } }))).toBe('x');
    expect(shortName(el('/a', { type: 'XCUIElementTypeOther', attributes: { name: 'n' } }))).toBe(
      'n',
    );
    // node.name is filled by the server from the id, text or type, so it is ignored.
    expect(shortName(el('/a', { name: 'scrim_view' }))).toBe('FrameLayout');
    expect(shortName(el('/a', { type: '' }))).toBe('Element');
  });
});

describe('folding', () => {
  it('folds plain wrappers into their only child', () => {
    const leaf = btn('/r/a/b/c');
    const b = el('/r/a/b', {}, [leaf, btn('/r/a/b/d')]);
    const a = el('/r/a', {}, [b]);
    const r = el('/r', { type: 'hierarchy' }, [a]);
    expect(foldRun(r).map((n) => n.xpath)).toEqual(['/r', '/r/a', '/r/a/b']);
  });

  it('never folds away something interactive or named', () => {
    const clickable = el('/c', { attributes: { clickable: 'true' } }, [el('/c/t')]);
    expect(isPlainWrapper(clickable)).toBe(false);
    expect(foldRun(clickable)).toHaveLength(1);
    const named = el('/n', { attributes: { 'content-desc': 'Card' } }, [el('/n/t')]);
    expect(foldRun(named)).toHaveLength(1);
  });

  it('ends a run at an interactive child, even one with a single child', () => {
    const inner = el('/w/b/t');
    const button = el('/w/b', { attributes: { clickable: 'true' } }, [inner]);
    const wrapper = el('/w', {}, [button]);
    expect(foldRun(wrapper).map((n) => n.xpath)).toEqual(['/w', '/w/b']);
  });
});

describe('visibleRows', () => {
  // r › a (plain, folds) › list with two buttons; the list is open.
  const one = btn('/r/a/l/1', 'One');
  const two = btn('/r/a/l/2', 'Two');
  const list = el('/r/a/l', { attributes: { scrollable: 'true' } }, [one, two]);
  const a = el('/r/a', {}, [list]);
  const root = el('/r', { type: 'hierarchy' }, [a]);

  it('flattens open rows with level, size and position', () => {
    const rows = visibleRows(root, new Set(['/r/a/l']));
    expect(rows.map((r) => [r.key, r.level, r.setSize, r.posInSet, r.parentKey])).toEqual([
      ['/r/a/l', 1, 1, 1, null],
      ['/r/a/l/1', 2, 2, 1, '/r/a/l'],
      ['/r/a/l/2', 2, 2, 2, '/r/a/l'],
    ]);
    expect(rows[0].nodes.map((n) => n.xpath)).toEqual(['/r', '/r/a', '/r/a/l']);
    expect(rows[0]).toMatchObject({ hasChildren: true, expanded: true });
    expect(rows[1]).toMatchObject({ hasChildren: false, expanded: false });
  });

  it('hides the children of a closed row', () => {
    const rows = visibleRows(root, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hasChildren: true, expanded: false });
  });

  it('keeps rows that match or lead to a match, opened, while searching', () => {
    const rows = visibleRows(root, new Set(), 'Two');
    expect(rows.map((r) => r.key)).toEqual(['/r/a/l', '/r/a/l/2']);
    expect(rows[0].expanded).toBe(true);
    expect(rows[1]).toMatchObject({ setSize: 1, posInSet: 1 });
  });

  // ← and the caret would toggle the open set with nothing changing on screen,
  // and the row would then flip closed once the search was cleared.
  it('marks a row the search holds open as not collapsible', () => {
    expect(visibleRows(root, new Set(), 'Two')[0]).toMatchObject({
      expanded: true,
      collapsible: false,
    });
    // Open in the user's set too: closing it still changes nothing on screen.
    expect(visibleRows(root, new Set(['/r/a/l']), 'Two')[0]).toMatchObject({
      expanded: true,
      collapsible: false,
    });
    expect(visibleRows(root, new Set(['/r/a/l']))[0]).toMatchObject({
      expanded: true,
      collapsible: true,
    });
    // Nothing to collapse: a closed row, a leaf.
    expect(visibleRows(root, new Set())[0].collapsible).toBe(false);
    expect(visibleRows(root, new Set(['/r/a/l']))[1].collapsible).toBe(false);
  });

  it('treats a blank query as none', () => {
    expect(visibleRows(root, new Set(['/r/a/l']), '   ')).toHaveLength(3);
  });

  it('returns no rows without a root', () => {
    expect(visibleRows(null, new Set())).toEqual([]);
  });

  it('counts matching nodes, not rows', () => {
    expect(matchSet(root, 'button').size).toBe(2);
    expect(matchSet(root, '').size).toBe(0);
  });
});

describe('initialExpanded', () => {
  it('opens three row levels', () => {
    const l4 = el('/1/2/3/4', {}, [btn('/1/2/3/4/x'), btn('/1/2/3/4/y')]);
    const l3 = el('/1/2/3', {}, [l4, btn('/1/2/3/z')]);
    const l2 = el('/1/2', {}, [l3, btn('/1/2/w')]);
    const l1 = el('/1', {}, [l2, btn('/1/v')]);
    const open = initialExpanded(l1);
    expect(Array.from(open).sort()).toEqual(['/1', '/1/2', '/1/2/3']);
  });
});

describe('paths', () => {
  const leaf = btn('/r/a/l/1');
  const list = el('/r/a/l', {}, [leaf, btn('/r/a/l/2')]);
  const a = el('/r/a', {}, [list]);
  const root = el('/r', {}, [a]);

  it('finds the path to a node, root first', () => {
    expect(pathTo(root, '/r/a/l/1')?.map((n) => n.xpath)).toEqual([
      '/r',
      '/r/a',
      '/r/a/l',
      '/r/a/l/1',
    ]);
    expect(pathTo(root, '/r')).toEqual([root]);
    expect(pathTo(root, '/nope')).toBeNull();
  });

  it('finds the row holding a node in the middle of a run', () => {
    const rows = visibleRows(root, new Set(['/r/a/l']));
    expect(rowIndexOf(rows, '/r/a')).toBe(0);
    expect(rowIndexOf(rows, '/r/a/l/1')).toBe(1);
    expect(rowIndexOf(rows, '/nope')).toBe(-1);
  });
});
