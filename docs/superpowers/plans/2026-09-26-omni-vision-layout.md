# Omni-Vision layout, compact tree and keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Omni-Vision a compact, keyboard-navigable element tree beside the details, with a draggable divider, a breadcrumb path and wrapped generated code.

**Architecture:**
- Pure rules, each tested directly: `treeRows.ts` (folding, names, flat visible rows, search, paths), `treeKeys.ts` (key → action) and `splitPane.ts` (limits and persistence).
- Three small components: `ElementTree`, `SplitDivider` and `ElementBreadcrumb`. `OmniInspector` keeps the state (snapshot, selection, open rows, search, split) and wires them together.
- The role rules move out of `OmniInspector.tsx` unchanged, so the tree can use them.

**Tech Stack:** React 17 (no automatic batching outside event handlers), lucide-react, Vitest + Testing Library (jsdom: no layout, no `ResizeObserver`, no `scrollIntoView`), Playwright for the live checks.

Spec: `docs/superpowers/specs/2026-09-26-omni-vision-layout-design.md`

## Global Constraints

- Divider: default share **0.4**; tree ≥ **240 px**, details ≥ **340 px**; **2 percentage points** per ← →; Home/End to the limits; double-click resets; stored in `localStorage['xenon.omni.split']` on release; 12 px wide.
- Rows: **26 px** high, **10 px** indent per level, guide lines in `--border`.
- A node folds into its only child when it is a plain wrapper: exactly one child, not interactive (`isInteractive` from `elementChecks.ts`), no text, content-desc or label.
- Name order: text, content-desc, label, resource id without its package, iOS `name` attribute, type's last segment.
- Shrink order on a short row: earlier parts of a run, then the muted type, then the target's name.
- Tree: `role="tree"` "Element tree"; rows `treeitem` with `aria-level`, `aria-setsize`, `aria-posinset`, `aria-selected`, `aria-expanded` (parents only); one tab stop.
- Rows at levels 1–3 open after a capture (counted after folding).
- Search placeholder "Search elements"; hint "N matches · try a role: button, input, image" ("1 match", "No matches").
- Breadcrumb: `nav` "Element path"; more than 4 ancestors collapse into "…" (`aria-label="Show all N ancestors"`).
- Tokens only (the colour-literal ratchet), no rule on shared Button classes, sentence case.
- Never run `eslint --fix` on whole files; compare lint counts with main (OmniInspector.tsx: 103 problems on main). Stage explicit paths.
- The Screenshot and Logs tabs stay pixel-identical (`scratchpad/dcshots`, threshold 0).

**Adjustments to the spec, made here on purpose:**
- `ElementTree` takes `matches: ReadonlySet<string>` (the xpaths that match the query) instead of `query`, and `hoveredXpath`, since the host already computes both.
- The row's parts, separators and type are direct flex children of the row (no wrapper), because nested flex containers can't express "parts, then type, then target" as a shrink order.

---

### Task 1: Move the role rules and the search rule (no behaviour change)

**Files:**
- Create: `web/src/components/omni-inspector/elementRole.tsx`, `web/src/components/omni-inspector/treeRows.ts`
- Modify: `web/src/components/omni-inspector/OmniInspector.tsx` (lines 267–333: `RoleKey`, `ElementRole`, `analyzeElement`, `ROLE_ICON`; lines 356–375: `smartSearch`)

**Interfaces (produces):**
- `elementRole.tsx`: `export type RoleKey`, `export interface ElementRole`, `export function analyzeElement(node: InspectorNode): ElementRole`, `export const ROLE_ICON: Record<RoleKey, React.ReactNode>`
- `treeRows.ts`: `export function smartSearch(node: InspectorNode, query: string): boolean`

- [ ] **Step 1:** Cut the four role declarations into `elementRole.tsx`, verbatim, adding `export`. Its header:

```tsx
import React from 'react';
import {
  Box,
  Image as ImageIcon,
  Layers,
  MousePointerClick,
  PanelTop,
  ScrollText,
  TextCursorInput,
  ToggleLeft,
  Type,
} from 'lucide-react';
import type { InspectorNode } from './OmniInspector';
```

- [ ] **Step 2:** Cut `smartSearch` into `treeRows.ts`, verbatim, exported, with `import type { InspectorNode } from './OmniInspector';`.
- [ ] **Step 3:** In `OmniInspector.tsx`, import `{ analyzeElement, ROLE_ICON, type RoleKey } from './elementRole'` and `{ smartSearch } from './treeRows'`. Drop lucide imports that are now unused there (check each with `grep -c`).
- [ ] **Step 4: Verify.** `cd web && npx tsc --noEmit -p . ; echo tsc=$?` → `tsc=0`. `npx vitest run src/components/omni-inspector` → all pass (29 today).
- [ ] **Step 5: Commit** `refactor(omni-vision): role and search rules in their own modules` (stage the three files).

---

### Task 2: `treeRows` — folding, names, visible rows, paths (TDD)

**Files:**
- Modify: `web/src/components/omni-inspector/treeRows.ts`
- Test: `web/src/components/omni-inspector/treeRows.test.ts`

**Interfaces (produces):**

```ts
export interface Row {
  key: string;            // the target's xpath
  nodes: InspectorNode[]; // the run, top first; the last is the target
  level: number;          // 1-based
  setSize: number;
  posInSet: number;
  hasChildren: boolean;   // the target has children
  expanded: boolean;      // the target is open, or held open by search
  parentKey: string | null;
}
export function shortResourceId(id: unknown): string;
export function shortType(node: InspectorNode): string;
export function shortName(node: InspectorNode): string;
export function isPlainWrapper(node: InspectorNode): boolean;
export function foldRun(node: InspectorNode): InspectorNode[];
export function matchSet(root: InspectorNode | null | undefined, query: string): Set<string>;
export function pathToMatch(root: InspectorNode | null | undefined, query: string): Set<string>;
export function visibleRows(root: InspectorNode | null | undefined, expanded: ReadonlySet<string>, query?: string): Row[];
export function initialExpanded(root: InspectorNode | null | undefined, levels?: number): Set<string>;
export function pathTo(root: InspectorNode | null | undefined, xpath: string): InspectorNode[] | null;
export function rowIndexOf(rows: Row[], xpath: string): number;
```

- [ ] **Step 1: Write the failing tests** in `treeRows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InspectorNode } from './OmniInspector';
import {
  foldRun,
  initialExpanded,
  isPlainWrapper,
  matchSet,
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
    expect([...open].sort()).toEqual(['/1', '/1/2', '/1/2/3']);
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
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/components/omni-inspector/treeRows.test.ts` → FAIL (exports missing).
- [ ] **Step 3: Implement** in `treeRows.ts`, below `smartSearch`:

```ts
import { isInteractive } from './elementChecks';

const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';

/** `com.app:id/login` → `login`; anything without `:id/` is returned as is. */
export function shortResourceId(id: unknown): string {
  const s = str(id);
  const i = s.indexOf(':id/');
  return i >= 0 ? s.slice(i + 4) : s;
}

/** The type's last segment: `android.widget.FrameLayout` → `FrameLayout`. */
export function shortType(node: InspectorNode): string {
  return (node.type || '').split('.').pop() || '';
}

/**
 * What the tree calls a node. `node.name` is left out on purpose: the server
 * fills it from the resource id, text or type, so it is never empty.
 */
export function shortName(node: InspectorNode): string {
  const a = node.attributes || {};
  return (
    str(node.text) ||
    str(a['content-desc']) ||
    str(node.label) ||
    str(a.label) ||
    shortResourceId(a['resource-id']) ||
    str(a.name) ||
    shortType(node) ||
    'Element'
  );
}

const hasName = (node: InspectorNode) => {
  const a = node.attributes || {};
  return !!(str(node.text) || str(a['content-desc']) || str(node.label) || str(a.label));
};

/** One child, nothing to tap, nothing to read: it can share its child's row. */
export function isPlainWrapper(node: InspectorNode): boolean {
  return (node.children?.length ?? 0) === 1 && !isInteractive(node) && !hasName(node);
}

/** The run of nodes that share one row, starting at `node`. */
export function foldRun(node: InspectorNode): InspectorNode[] {
  const run = [node];
  let cur = node;
  while (isPlainWrapper(cur)) {
    cur = cur.children[0];
    run.push(cur);
  }
  return run;
}

/** The xpaths of the nodes that match; empty for a blank query. */
export function matchSet(root: InspectorNode | null | undefined, query: string): Set<string> {
  const out = new Set<string>();
  if (!root || !query.trim()) return out;
  const visit = (n: InspectorNode) => {
    if (smartSearch(n, query)) out.add(n.xpath);
    n.children?.forEach(visit);
  };
  visit(root);
  return out;
}

/** The xpaths of the nodes with a match somewhere below them. */
export function pathToMatch(root: InspectorNode | null | undefined, query: string): Set<string> {
  const out = new Set<string>();
  if (!root || !query.trim()) return out;
  const visit = (n: InspectorNode): boolean => {
    let below = false;
    for (const c of n.children || []) if (visit(c)) below = true;
    if (below) out.add(n.xpath);
    return below || smartSearch(n, query);
  };
  visit(root);
  return out;
}

/** The tree as the rows on screen, top to bottom. */
export function visibleRows(
  root: InspectorNode | null | undefined,
  expanded: ReadonlySet<string>,
  query = '',
): Row[] {
  if (!root) return [];
  const searching = !!query.trim();
  const matches = searching ? matchSet(root, query) : null;
  const leads = searching ? pathToMatch(root, query) : null;
  const shows = (run: InspectorNode[]) =>
    !searching || run.some((n) => matches!.has(n.xpath) || leads!.has(n.xpath));
  const out: Row[] = [];
  const emit = (siblings: InspectorNode[], level: number, parentKey: string | null) => {
    const runs = siblings.map(foldRun).filter(shows);
    runs.forEach((run, i) => {
      const target = run[run.length - 1];
      const hasChildren = (target.children?.length ?? 0) > 0;
      const expandedNow =
        hasChildren && (expanded.has(target.xpath) || (searching && leads!.has(target.xpath)));
      out.push({
        key: target.xpath,
        nodes: run,
        level,
        setSize: runs.length,
        posInSet: i + 1,
        hasChildren,
        expanded: expandedNow,
        parentKey,
      });
      if (expandedNow) emit(target.children, level + 1, target.xpath);
    });
  };
  emit([root], 1, null);
  return out;
}

/** The rows open after a capture: the first `levels` row levels. */
export function initialExpanded(
  root: InspectorNode | null | undefined,
  levels = 3,
): Set<string> {
  const open = new Set<string>();
  const walk = (node: InspectorNode, level: number) => {
    const run = foldRun(node);
    const target = run[run.length - 1];
    if (level > levels || !target.children?.length) return;
    open.add(target.xpath);
    target.children.forEach((c) => walk(c, level + 1));
  };
  if (root) walk(root, 1);
  return open;
}

/** Root first, ending with the node; null when the xpath isn't in the tree. */
export function pathTo(
  root: InspectorNode | null | undefined,
  xpath: string,
): InspectorNode[] | null {
  if (!root) return null;
  if (root.xpath === xpath) return [root];
  for (const c of root.children || []) {
    const p = pathTo(c, xpath);
    if (p) return [root, ...p];
  }
  return null;
}

/** The index of the row that holds the node, or -1. */
export function rowIndexOf(rows: Row[], xpath: string): number {
  return rows.findIndex((r) => r.nodes.some((n) => n.xpath === xpath));
}
```

Plus the `Row` interface above, with a one-line comment on each field.

- [ ] **Step 4: Run** the test file → PASS. **Mutation-check** once: make `isPlainWrapper` ignore `isInteractive` → the "never folds away" test fails; revert.
- [ ] **Step 5: Commit** `feat(omni-vision): tree rows — fold wrapper runs, short names, flat visible rows` (stage `treeRows.ts`, `treeRows.test.ts`).

---

### Task 3: `treeKeys` and `splitPane` (TDD)

**Files:**
- Create: `web/src/components/omni-inspector/treeKeys.ts`, `web/src/components/omni-inspector/splitPane.ts`
- Test: `web/src/components/omni-inspector/treeKeys.test.ts`, `web/src/components/omni-inspector/splitPane.test.ts`

**Interfaces (produces):**

```ts
// treeKeys.ts
export type TreeKeyAction = { focus: number } | { toggle: string } | { select: InspectorNode };
export function treeKeyAction(rows: Row[], index: number, key: string): TreeKeyAction | null;
// splitPane.ts
export const DEFAULT_SPLIT = 0.4, MIN_TREE_PX = 240, MIN_DETAILS_PX = 340, SPLIT_STEP = 0.02, DIVIDER_PX = 12;
export const SPLIT_KEY = 'xenon.omni.split';
export interface SplitLimits { min: number; max: number }
export type SplitStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function splitLimits(width: number): SplitLimits;
export function clampSplit(share: number, width: number): number;
export function loadSplit(storage: SplitStorage | null): number;
export function saveSplit(storage: SplitStorage | null, share: number): void;
export function browserStorage(): SplitStorage | null;
```

- [ ] **Step 1: Write the failing tests.** `treeKeys.test.ts`:

```ts
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
  parentKey: null,
  ...over,
});
// 0 /a (open) › 1 /a/b (closed, has children) · 2 /a/c (leaf)
const rows = [
  row('/a', { hasChildren: true, expanded: true, nodes: [node('/'), node('/a')] }),
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

  it('Home and End jump to the ends', () => {
    expect(treeKeyAction(rows, 1, 'Home')).toEqual({ focus: 0 });
    expect(treeKeyAction(rows, 0, 'End')).toEqual({ focus: 2 });
  });

  it('Enter and Space select the row’s target, the last node of its run', () => {
    expect(treeKeyAction(rows, 0, 'Enter')).toEqual({ select: rows[0].nodes[1] });
    expect(treeKeyAction(rows, 2, ' ')).toEqual({ select: rows[2].nodes[0] });
  });

  it('ignores other keys and a missing row', () => {
    expect(treeKeyAction(rows, 0, 'a')).toBeNull();
    expect(treeKeyAction(rows, 9, 'ArrowDown')).toBeNull();
  });
});
```

`splitPane.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clampSplit, DEFAULT_SPLIT, loadSplit, saveSplit, SPLIT_KEY, splitLimits } from './splitPane';

const store = (value: string | null) => {
  const saved: Record<string, string> = {};
  return {
    saved,
    getItem: () => value,
    setItem: (k: string, v: string) => {
      saved[k] = v;
    },
  };
};
const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('split limits', () => {
  it('keeps 240 px for the tree and 340 px for the details', () => {
    const { min, max } = splitLimits(828);
    expect(min * 828).toBeCloseTo(240);
    expect((1 - max) * 828).toBeCloseTo(340);
    expect(clampSplit(0.1, 828)).toBeCloseTo(min);
    expect(clampSplit(0.9, 828)).toBeCloseTo(max);
    expect(clampSplit(0.4, 828)).toBe(0.4);
  });

  it('gives the tree its minimum when the row is too narrow for both', () => {
    expect(clampSplit(0.4, 500) * 500).toBeCloseTo(240);
    expect(splitLimits(500).max).toBeCloseTo(splitLimits(500).min);
  });

  it('clamps nothing before the width is known, and repairs junk', () => {
    expect(splitLimits(0)).toEqual({ min: 0, max: 1 });
    expect(clampSplit(0.7, 0)).toBe(0.7);
    expect(clampSplit(Number.NaN, 828)).toBe(DEFAULT_SPLIT);
  });
});

describe('split persistence', () => {
  it('reads a stored share and falls back to 0.4 on anything else', () => {
    expect(loadSplit(store('0.55'))).toBe(0.55);
    for (const v of [null, 'abc', '0', '1', '1.5', '-0.2']) expect(loadSplit(store(v))).toBe(0.4);
    expect(loadSplit(throwing)).toBe(0.4);
    expect(loadSplit(null)).toBe(0.4);
  });

  it('writes the share, and ignores storage that throws', () => {
    const s = store(null);
    saveSplit(s, 0.4567);
    expect(s.saved[SPLIT_KEY]).toBe('0.457');
    expect(() => saveSplit(throwing, 0.5)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run** both files → FAIL (modules missing).
- [ ] **Step 3: Implement** `treeKeys.ts`:

```ts
import type { InspectorNode } from './OmniInspector';
import type { Row } from './treeRows';

export type TreeKeyAction = { focus: number } | { toggle: string } | { select: InspectorNode };

/** What a key does on row `index`, per the WAI-ARIA tree pattern; null if nothing. */
export function treeKeyAction(rows: Row[], index: number, key: string): TreeKeyAction | null {
  const row = rows[index];
  if (!row) return null;
  switch (key) {
    case 'ArrowDown':
      return index < rows.length - 1 ? { focus: index + 1 } : null;
    case 'ArrowUp':
      return index > 0 ? { focus: index - 1 } : null;
    case 'ArrowRight':
      if (!row.hasChildren) return null;
      if (!row.expanded) return { toggle: row.key };
      return rows[index + 1]?.parentKey === row.key ? { focus: index + 1 } : null;
    case 'ArrowLeft': {
      if (row.hasChildren && row.expanded) return { toggle: row.key };
      const parent = rows.findIndex((r) => r.key === row.parentKey);
      return parent >= 0 ? { focus: parent } : null;
    }
    case 'Home':
      return { focus: 0 };
    case 'End':
      return { focus: rows.length - 1 };
    case 'Enter':
    case ' ':
      return { select: row.nodes[row.nodes.length - 1] };
    default:
      return null;
  }
}
```

`splitPane.ts`:

```ts
/** The tree's share of the tree + details row, and where it is remembered. */
export const DEFAULT_SPLIT = 0.4;
export const MIN_TREE_PX = 240;
export const MIN_DETAILS_PX = 340;
export const SPLIT_STEP = 0.02;
export const DIVIDER_PX = 12;
export const SPLIT_KEY = 'xenon.omni.split';

export interface SplitLimits {
  min: number;
  max: number;
}
export type SplitStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The tree's allowed share of a row `width` px wide (the divider excluded).
 * Before the width is known (0) nothing is clamped. Too narrow for both
 * minimums, the tree gets its minimum and the details the rest.
 */
export function splitLimits(width: number): SplitLimits {
  if (!(width > 0)) return { min: 0, max: 1 };
  const min = Math.min(1, MIN_TREE_PX / width);
  return { min, max: Math.max(min, (width - MIN_DETAILS_PX) / width) };
}

export function clampSplit(share: number, width: number): number {
  const { min, max } = splitLimits(width);
  const s = Number.isFinite(share) ? share : DEFAULT_SPLIT;
  return Math.min(max, Math.max(min, s));
}

export function loadSplit(storage: SplitStorage | null): number {
  try {
    const v = Number.parseFloat(storage?.getItem(SPLIT_KEY) ?? '');
    return v > 0 && v < 1 ? v : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

export function saveSplit(storage: SplitStorage | null, share: number): void {
  try {
    storage?.setItem(SPLIT_KEY, String(Math.round(share * 1000) / 1000));
  } catch {
    // Storage blocked or full: the divider keeps its position until reload.
  }
}

/** `window.localStorage`, or null where reading it throws (blocked site data). */
export function browserStorage(): SplitStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run** both files → PASS.
- [ ] **Step 5: Commit** `feat(omni-vision): tree keys and divider limits` (stage the four files).

---

### Task 4: `ElementTree` and its styles (TDD)

**Files:**
- Create: `web/src/components/omni-inspector/ElementTree.tsx`
- Test: `web/src/components/omni-inspector/ElementTree.test.tsx`
- Modify: `web/src/components/omni-inspector/omni-inspector.css` (add `.omni-tree*` rules; the old `.tree-*` rules go in Task 5, when nothing renders them)

**Interfaces:**
- Consumes: `Row`, `rowIndexOf`, `shortName`, `shortType` (Task 2); `treeKeyAction` (Task 3); `analyzeElement`, `ROLE_ICON` (Task 1).
- Produces: `export default function ElementTree(props: ElementTreeProps)` with

```ts
interface ElementTreeProps {
  rows: Row[];
  selectedXpath: string | null;
  hoveredXpath: string | null;
  matches: ReadonlySet<string>;
  onToggle: (xpath: string) => void;
  onSelect: (node: InspectorNode) => void;
  onHover: (node: InspectorNode | null) => void;
}
```

- [ ] **Step 1: Write the failing tests** in `ElementTree.test.tsx`. A harness owns the open set and the selection:

```tsx
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InspectorNode } from './OmniInspector';
import ElementTree from './ElementTree';
import { initialExpanded, visibleRows } from './treeRows';

function el(xpath: string, over: Partial<InspectorNode> = {}, children: InspectorNode[] = []) {
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
  } as InspectorNode;
}
const btn = (xpath: string, text: string) =>
  el(xpath, { type: 'android.widget.Button', text, attributes: { clickable: 'true' } });

// hierarchy › content (folded) › list [ One, Two, card › [ Three, Four ] ]
const card = el('/h/c/l/card', { attributes: { 'content-desc': 'Card' } }, [
  btn('/h/c/l/card/3', 'Three'),
  btn('/h/c/l/card/4', 'Four'),
]);
const list = el('/h/c/l', { attributes: { scrollable: 'true' } }, [
  btn('/h/c/l/1', 'One'),
  btn('/h/c/l/2', 'Two'),
  card,
]);
const root = el('/h', { type: 'hierarchy' }, [
  el('/h/c', { attributes: { 'resource-id': 'android:id/content' } }, [list]),
]);

function Harness({ onSelect = () => {} }: { onSelect?: (n: InspectorNode) => void }) {
  const [open, setOpen] = React.useState(() => new Set(['/h/c/l']));
  const [selected, setSelected] = React.useState<string | null>(null);
  return (
    <ElementTree
      rows={visibleRows(root, open)}
      selectedXpath={selected}
      hoveredXpath={null}
      matches={new Set()}
      onToggle={(x) =>
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(x)) next.delete(x);
          else next.add(x);
          return next;
        })
      }
      onSelect={(n) => {
        setSelected(n.xpath);
        onSelect(n);
      }}
      onHover={() => {}}
    />
  );
}

const item = (name: RegExp) => screen.getByRole('treeitem', { name });

describe('ElementTree', () => {
  it('is a tree whose rows carry level, size, position and open state', () => {
    render(<Harness />);
    expect(screen.getByRole('tree', { name: 'Element tree' })).toBeInTheDocument();
    const top = item(/content/);
    expect(top).toHaveAttribute('aria-level', '1');
    expect(top).toHaveAttribute('aria-expanded', 'true');
    const two = item(/Two/);
    expect(two).toHaveAttribute('aria-level', '2');
    expect(two).toHaveAttribute('aria-setsize', '3');
    expect(two).toHaveAttribute('aria-posinset', '2');
    expect(two).not.toHaveAttribute('aria-expanded');
    expect(item(/Card/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('folds a wrapper run into one row with a part per node', () => {
    render(<Harness />);
    expect(item(/hierarchy.*content/)).toBeInTheDocument();
  });

  it('has one tab stop', () => {
    render(<Harness />);
    const stops = screen.getAllByRole('treeitem').filter((r) => r.tabIndex === 0);
    expect(stops).toHaveLength(1);
  });

  it('moves with the arrow keys, Home and End', () => {
    render(<Harness />);
    const top = item(/content/);
    top.focus();
    fireEvent.keyDown(top, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item(/One/));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(item(/Card/));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(top);
  });

  it('opens with → and closes with ←, and ← on a child goes to its parent', () => {
    render(<Harness />);
    const cardRow = item(/Card/);
    cardRow.focus();
    fireEvent.keyDown(cardRow, { key: 'ArrowRight' });
    expect(item(/Card/)).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(item(/Card/), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(item(/Three/));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(item(/Card/));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(item(/Card/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects the row’s target with Enter or Space', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const two = item(/Two/);
    two.focus();
    fireEvent.keyDown(two, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xpath: '/h/c/l/2' }));
    expect(item(/Two/)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(item(/One/), { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xpath: '/h/c/l/1' }));
  });

  it('selects a node in the middle of a run when its part is clicked', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByText('hierarchy'));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xpath: '/h' }));
  });

  it('keeps focus in the tree when the focused row is collapsed away', () => {
    render(<Harness />);
    const three = () => screen.queryByRole('treeitem', { name: /Three/ });
    fireEvent.keyDown(item(/Card/), { key: 'ArrowRight' });
    three()!.focus();
    fireEvent.click(item(/Card/).querySelector('.omni-tree-row__caret')!);
    expect(three()).toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/components/omni-inspector/ElementTree.test.tsx` → FAIL (module missing).
- [ ] **Step 3: Implement** `ElementTree.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { InspectorNode } from './OmniInspector';
import { rowIndexOf, shortName, shortType, type Row } from './treeRows';
import { treeKeyAction } from './treeKeys';
import { analyzeElement, ROLE_ICON } from './elementRole';

const INDENT_PX = 10;

/** The full type, resource id and text, one per line, for the tooltip. */
function tooltip(node: InspectorNode): string {
  const id = node.attributes?.['resource-id'];
  return [node.type, id, node.text]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join('\n');
}

interface ElementTreeProps { /* as above */ }

/**
 * The element tree as a WAI-ARIA tree: one tab stop, arrow keys to move,
 * → and ← to open and close, Enter or Space to select. A row may hold a run
 * of wrappers (see foldRun); each part selects its own node.
 */
export default function ElementTree({
  rows,
  selectedXpath,
  hoveredXpath,
  matches,
  onToggle,
  onSelect,
  onHover,
}: ElementTreeProps) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const pendingReveal = useRef<string | null>(null);

  const selectedIndex = selectedXpath ? rowIndexOf(rows, selectedXpath) : -1;
  const keyedIndex = focusKey ? rows.findIndex((r) => r.key === focusKey) : -1;
  const tabIndexRow = keyedIndex >= 0 ? keyedIndex : Math.max(selectedIndex, 0);

  const rowEl = (i: number) =>
    treeRef.current?.querySelector<HTMLElement>(`[data-row="${i}"]`) ?? null;
  const targetOf = (row: Row) => row.nodes[row.nodes.length - 1];

  const focusRow = (i: number) => {
    const row = rows[i];
    if (!row) return;
    setFocusKey(row.key);
    lastIndex.current = i;
    const el = rowEl(i);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  };

  // Scroll a newly selected node's row into view once it exists: the host
  // opens the rows on the way to it, so it may appear a render later.
  useEffect(() => {
    pendingReveal.current = selectedXpath;
  }, [selectedXpath]);
  useEffect(() => {
    const xpath = pendingReveal.current;
    if (!xpath) return;
    const i = rowIndexOf(rows, xpath);
    if (i < 0) return;
    rowEl(i)?.scrollIntoView?.({ block: 'nearest' });
    pendingReveal.current = null;
  });

  // The focused row went away (its parent closed, or a new capture): keep
  // focus in the tree, on the row that took its place.
  useEffect(() => {
    if (!focusKey || rows.some((r) => r.key === focusKey)) return;
    const i = Math.min(lastIndex.current, rows.length - 1);
    const lost = !document.activeElement || document.activeElement === document.body;
    setFocusKey(rows[i]?.key ?? null);
    if (lost && i >= 0) rowEl(i)?.focus();
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.getAttribute('role') !== 'treeitem') return;
    const action = treeKeyAction(rows, Number(el.dataset.row), e.key);
    if (!action) return;
    e.preventDefault();
    if ('focus' in action) focusRow(action.focus);
    else if ('toggle' in action) onToggle(action.toggle);
    else onSelect(action.select);
  };

  const onBlur = (e: React.FocusEvent) => {
    if (!treeRef.current?.contains(e.relatedTarget as Node | null)) onHover(null);
  };

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Element tree"
      className="omni-tree"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {rows.map((row, i) => {
        const target = targetOf(row);
        const inRow = (x: string | null) => !!x && row.nodes.some((n) => n.xpath === x);
        const selected = inRow(selectedXpath);
        const hovered = !selected && inRow(hoveredXpath);
        const name = shortName(target);
        const type = shortType(target);
        return (
          <div
            key={row.key}
            data-row={i}
            role="treeitem"
            aria-level={row.level}
            aria-setsize={row.setSize}
            aria-posinset={row.posInSet}
            aria-selected={selected}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            tabIndex={i === tabIndexRow ? 0 : -1}
            className={`omni-tree-row${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`}
            onClick={() => onSelect(target)}
            onFocus={(e) => {
              if (e.target !== e.currentTarget) return;
              setFocusKey(row.key);
              lastIndex.current = i;
              onHover(target);
            }}
            onMouseEnter={() => onHover(target)}
            onMouseLeave={() => onHover(null)}
          >
            <span
              className="omni-tree-row__indent"
              style={{ width: (row.level - 1) * INDENT_PX }}
              aria-hidden="true"
            />
            <span
              className="omni-tree-row__caret"
              aria-hidden="true"
              onClick={
                row.hasChildren
                  ? (e) => {
                      e.stopPropagation();
                      onToggle(row.key);
                    }
                  : undefined
              }
            >
              {row.hasChildren &&
                (row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
            </span>
            <span className="omni-tree-row__icon" aria-hidden="true">
              {ROLE_ICON[analyzeElement(target).key]}
            </span>
            {row.nodes.map((n, j) => {
              const last = j === row.nodes.length - 1;
              return (
                <React.Fragment key={n.xpath}>
                  {j > 0 && (
                    <span className="omni-tree-row__sep" aria-hidden="true">
                      ›
                    </span>
                  )}
                  <span
                    className={`omni-tree-row__part${last ? ' is-target' : ''}${
                      matches.has(n.xpath) ? ' is-match' : ''
                    }${n.xpath === selectedXpath ? ' is-current' : ''}`}
                    title={tooltip(n)}
                    onClick={
                      last
                        ? undefined
                        : (e) => {
                            e.stopPropagation();
                            onSelect(n);
                          }
                    }
                    onMouseEnter={last ? undefined : () => onHover(n)}
                    onMouseLeave={last ? undefined : () => onHover(target)}
                  >
                    {shortName(n)}
                  </span>
                </React.Fragment>
              );
            })}
            {type && type !== name && <span className="omni-tree-row__type">{type}</span>}
            {row.hasChildren && !row.expanded && (
              <span className="omni-tree-row__count" aria-hidden="true">
                {target.children.length}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Styles.** Append to `omni-inspector.css` (tokens only):

```css
/* ===== Element tree (ElementTree.tsx) =====
   Rows are 26px; parts, separators and the type are direct flex children so
   the shrink weights read: earlier parts first, then the type, the target's
   name last. */
.omni-tree {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.omni-tree-row {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    min-width: 0;
    padding: 0 8px 0 6px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    flex-shrink: 0;
}

.omni-tree-row:hover,
.omni-tree-row.is-hovered {
    background: rgb(var(--rgb-fg) / 0.05);
}

.omni-tree-row.is-selected {
    background: rgb(var(--rgb-accent) / 0.12);
    box-shadow: inset 2px 0 0 var(--color-accent);
}

.omni-tree-row:focus {
    outline: none;
}

.omni-tree-row:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
}

/* One guide per ancestor level, under that ancestor's caret. */
.omni-tree-row__indent {
    flex-shrink: 0;
    align-self: stretch;
    background-image: linear-gradient(to right, var(--border) 1px, transparent 1px);
    background-size: 10px 100%;
    background-position: 6px 0;
    background-repeat: repeat-x;
}

.omni-tree-row__caret,
.omni-tree-row__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-muted);
}

.omni-tree-row__caret {
    width: 12px;
}

.omni-tree-row__part,
.omni-tree-row__type {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.omni-tree-row__part {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    flex: 0 1000 auto;
}

.omni-tree-row__part.is-target {
    flex: 0 1 auto;
    color: var(--text);
}

.omni-tree-row__part.is-match {
    color: var(--color-highlight);
}

.omni-tree-row__part.is-current {
    text-decoration: underline;
    text-underline-offset: 3px;
}

.omni-tree-row__sep {
    flex-shrink: 0;
    color: var(--text-dim);
}

.omni-tree-row__type {
    flex: 0 100 auto;
    font-size: 11px;
    color: var(--text-dim);
}

.omni-tree-row__count {
    flex-shrink: 0;
    margin-left: auto;
    padding-left: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--text-dim);
}
```

- [ ] **Step 5: Run** the test file → PASS. Run `npx vitest run src/design` → the colour ratchet and button guard pass.
- [ ] **Step 6: Commit** `feat(omni-vision): ElementTree — compact rows, folded runs, keyboard tree` (stage `ElementTree.tsx`, `ElementTree.test.tsx`, `omni-inspector.css`).

---

### Task 5: Wire the tree into OmniInspector (TDD)

**Files:**
- Modify: `web/src/components/omni-inspector/OmniInspector.tsx`, `web/src/components/omni-inspector/omni-inspector.css`, `web/src/components/omni-inspector/OmniInspector.test.tsx`

**Interfaces:**
- Consumes: `ElementTree` (Task 4); `visibleRows`, `matchSet`, `initialExpanded`, `pathTo` (Task 2).

- [ ] **Step 1: Update the #331 tests for the new names, and write the new failing tests.**
  - The tree now names a row by its text, so `button(id)` gets `text: id.split('/').pop()` (`login`, `first`, `second`), and the tests find rows with `screen.findByRole('treeitem', { name: /login/ })` instead of `findByText('com.app:id/login')`. The race test checks `treeitem` names `/second/` and not `/first/`.
  - The deep-search fixture gives each wrapper a second child, placed **before** the chain (`button(\`com.app:id/sib${depth}\`)`), so the wrappers don't fold, the mic sits below the three levels that open, and the mic is the last leaf the overlay draws (hit areas follow document order).
  - New tests:

```tsx
describe('OmniInspector — tree', () => {
  it('renders the element tree with the count in the capture line', async () => {
    render(<OmniInspector udid="U1" embedded />);
    expect(await screen.findByRole('tree', { name: 'Element tree' })).toBeInTheDocument();
    expect(screen.getByText('2 elements')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search elements' })).toHaveAttribute(
      'placeholder',
      'Search elements',
    );
  });

  it('counts matches under the search box', async () => {
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    const box = screen.getByRole('textbox', { name: 'Search elements' });
    fireEvent.change(box, { target: { value: 'login' } });
    expect(screen.getByText(/^1 match · try a role/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText(/^No matches · try a role/)).toBeInTheDocument();
  });

  it('keeps a node selected from search visible after the search is cleared', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    const box = screen.getByRole('textbox', { name: 'Search elements' });
    fireEvent.change(box, { target: { value: 'Voice' } });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Voice search/ }));
    fireEvent.change(box, { target: { value: '' } });
    expect(screen.getByRole('treeitem', { name: /Voice search/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('reveals a node picked on the phone', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    const target = document.createElement('div');
    document.body.appendChild(target);
    render(<OmniInspector udid="U1" embedded overlayTarget={target} />);
    await screen.findByRole('tree');
    expect(screen.queryByRole('treeitem', { name: /Voice search/ })).toBeNull();
    // The mic is the deepest leaf, so its hit area is drawn last.
    const areas = target.querySelectorAll('.omni-hit-area');
    fireEvent.click(areas[areas.length - 1]);
    expect(await screen.findByRole('treeitem', { name: /Voice search/ })).toBeInTheDocument();
    target.remove();
  });

  it('follows the selection’s xpath into a new capture, and clears it when gone', async () => {
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
    const renamed = snapshot();
    renamed.hierarchy.children[0].text = 'Sign in';
    api.getInspectorSnapshot.mockResolvedValueOnce(renamed);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    expect(await screen.findByRole('treeitem', { name: /Sign in/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    api.getInspectorSnapshot.mockResolvedValueOnce(snapshot('com.app:id/other'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    expect(await screen.findByText('No element selected')).toBeInTheDocument();
  });
});
```

  `deepSnapshot()` is the deep-search fixture, lifted into a function so three tests share it. `snapshot('com.app:id/other')` differs in xpath, since `button(id)` sets `xpath: /hierarchy/${id}`.

- [ ] **Step 2: Run** `npx vitest run src/components/omni-inspector/OmniInspector.test.tsx` → the new tests FAIL; the updated #331 tests fail only where they need the tree (name lookups).
- [ ] **Step 3: Implement in `OmniInspector.tsx`:**
  - Imports: `ElementTree`; `{ initialExpanded, matchSet, pathTo, visibleRows }`; `unstable_batchedUpdates` from `react-dom`.
  - `toggleExpand` uses a functional update; `collapseAll` sets `new Set()`.
  - `loadSnapshot` success path, in one batch (React 17 renders each `setState` after an `await` separately, and the reveal effect would otherwise run between them and be overwritten):

```ts
unstable_batchedUpdates(() => {
  setSnapshot(data);
  setCapturedAt(Date.now());
  setExpandedNodes(initialExpanded(data.hierarchy));
  // The selection follows its xpath into the new capture; the old node
  // object described the old screen.
  setSelectedNode((prev) => (prev ? pathTo(data.hierarchy, prev.xpath)?.pop() ?? null : null));
});
```

  - Derived state:

```ts
const rows = useMemo(
  () => visibleRows(snapshot?.hierarchy, expandedNodes, searchQuery),
  [snapshot, expandedNodes, searchQuery],
);
const matches = useMemo(
  () => matchSet(snapshot?.hierarchy, searchQuery),
  [snapshot, searchQuery],
);
```

  - The reveal: whenever the selection or the capture changes, open every ancestor.

```ts
useEffect(() => {
  if (!selectedNode || !snapshot?.hierarchy) return;
  const path = pathTo(snapshot.hierarchy, selectedNode.xpath);
  if (!path || path.length < 2) return;
  setExpandedNodes((prev) => {
    const missing = path.slice(0, -1).filter((n) => !prev.has(n.xpath));
    if (!missing.length) return prev;
    const next = new Set(prev);
    missing.forEach((n) => next.add(n.xpath));
    return next;
  });
}, [selectedNode, snapshot]);
```

  - `selectNode = (n: InspectorNode) => { setSelectedNode(n); setActiveTab('info'); }`, used by the tree, the hit areas and (Task 7) the breadcrumb.
  - The tree content renders `<ElementTree rows={rows} selectedXpath={selectedNode?.xpath ?? null} hoveredXpath={hoveredNode?.xpath ?? null} matches={matches} onToggle={toggleExpand} onSelect={selectNode} onHover={setHoveredNode} />` when there is a hierarchy; the empty state otherwise.
  - Delete `renderTree`, the `searchOpen` memo and their now-unused imports.
  - Header: remove the count badge and the source badge from `.omni-tree-title`. The meta line (not stale) becomes:

```tsx
<div className="omni-capture-meta">
  <span>
    {totalElements} {totalElements === 1 ? 'element' : 'elements'}
  </span>
  {snapshot.hierarchySource && (
    <>
      <span aria-hidden="true">·</span>
      <span
        className="omni-capture-source"
        title={
          snapshot.hierarchySource === 'appium-session'
            ? `From Appium session ${snapshot.sessionId} — the same tree the driver resolves locators against`
            : 'Read from the device. No Appium session is driving it.'
        }
      >
        {snapshot.hierarchySource === 'appium-session' ? 'Session' : 'Device'}
      </span>
    </>
  )}
  <span aria-hidden="true">·</span>
  <span>{captureAge(capturedAt, now)}</span>
</div>
```

  - Search: placeholder "Search elements". The hint, shown while `searchQuery.trim()`:

```tsx
<div className="omni-search-hint" role="status">
  {matches.size === 0 ? 'No matches' : matches.size === 1 ? '1 match' : `${matches.size} matches`}{' '}
  · try a role: button, input, image
</div>
```

- [ ] **Step 4: CSS.**
  - Delete the rules only the old tree used: `.tree-item*`, `.tree-node`, `.tree-children`, `.tree-toggle*`, `.tree-item-indent`, `.tree-icon`, `.tree-label`, `.tree-badge`, `.tree-text-preview`, `.tree-type-tag`, `.omni-count-badge`, `.omni-source-badge*` (check each with `grep -rn` across `web/src` first), and the wrapping comment above `.omni-tree-header` that described the pills.
  - `.omni-tree-content` gets `overflow-x: hidden` and `padding: 4px`.
  - `.omni-capture-meta` keeps its rules; add `gap: 6px` if it isn't there, and `.omni-capture-source { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }`.
  - `.omni-search-hint`: `color: var(--text-muted)`, no `opacity`, no italic, no accent background.
- [ ] **Step 5: Verify.** The OmniInspector and ElementTree tests pass; the whole web suite passes (`npx vitest run`); `npx tsc --noEmit -p . ; echo tsc=$?` → 0; `npx eslint src/components/omni-inspector/OmniInspector.tsx | grep problems` ≤ 103; the new files have no lint errors.
- [ ] **Step 6: Commit** `feat(omni-vision): compact keyboard tree in Omni-Vision; the selection follows refreshes` (stage the three files).

---

### Task 6: The divider (TDD)

**Files:**
- Create: `web/src/components/omni-inspector/SplitDivider.tsx`
- Modify: `web/src/components/omni-inspector/OmniInspector.tsx`, `web/src/components/omni-inspector/omni-inspector.css`, `web/src/components/omni-inspector/OmniInspector.test.tsx`

**Interfaces:**
- Consumes: `splitLimits`, `clampSplit`, `loadSplit`, `saveSplit`, `browserStorage`, `DEFAULT_SPLIT`, `SPLIT_STEP`, `DIVIDER_PX`, `SPLIT_KEY` (Task 3).
- Produces: `export default function SplitDivider(props: { share: number; limits: SplitLimits; containerRef: React.RefObject<HTMLElement>; onChange: (share: number) => void; onCommit: (share: number) => void; onReset: () => void })`

- [ ] **Step 1: Write the failing test** (jsdom has no layout, so the width is 0 and nothing is clamped: min 0, max 100):

```tsx
describe('OmniInspector — divider', () => {
  beforeEach(() => localStorage.removeItem('xenon.omni.split'));

  it('resizes the tree from the keyboard, remembers it, and resets on double-click', async () => {
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    const sep = screen.getByRole('separator', { name: 'Resize element tree' });
    expect(sep).toHaveAttribute('aria-valuenow', '40');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(sep).toHaveAttribute('aria-valuenow', '42');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sep).toHaveAttribute('aria-valuenow', '38');
    expect(localStorage.getItem('xenon.omni.split')).toBe('0.38');
    fireEvent.keyDown(sep, { key: 'End' });
    expect(sep).toHaveAttribute('aria-valuenow', sep.getAttribute('aria-valuemax')!);
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(sep).toHaveAttribute('aria-valuenow', sep.getAttribute('aria-valuemin')!);
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute('aria-valuenow', '40');
  });

  it('starts from the remembered share', async () => {
    localStorage.setItem('xenon.omni.split', '0.5');
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '50');
  });
});
```

- [ ] **Step 2: Run** → FAIL (no separator).
- [ ] **Step 3: Implement** `SplitDivider.tsx`:

```tsx
import React, { useRef, useState } from 'react';
import { DIVIDER_PX, SPLIT_STEP, type SplitLimits } from './splitPane';

interface SplitDividerProps {
  share: number;
  limits: SplitLimits;
  containerRef: React.RefObject<HTMLElement>;
  onChange: (share: number) => void;
  onCommit: (share: number) => void;
  onReset: () => void;
}

/** The handle between the tree and the details: drag it, or focus it and use ← → Home End. */
export default function SplitDivider({
  share,
  limits,
  containerRef,
  onChange,
  onCommit,
  onReset,
}: SplitDividerProps) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(share);
  latest.current = share;
  const clamp = (s: number) => Math.min(limits.max, Math.max(limits.min, s));
  const pct = (s: number) => Math.round(s * 100);

  const fromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= DIVIDER_PX) return latest.current;
    return clamp((clientX - rect.left - DIVIDER_PX / 2) / (rect.width - DIVIDER_PX));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const next =
      e.key === 'ArrowLeft'
        ? share - SPLIT_STEP
        : e.key === 'ArrowRight'
          ? share + SPLIT_STEP
          : e.key === 'Home'
            ? limits.min
            : e.key === 'End'
              ? limits.max
              : null;
    if (next === null) return;
    e.preventDefault();
    // Rounded so repeated steps don't drift (0.4 - 0.02 - 0.02 = 0.36000000000000004).
    onCommit(clamp(Math.round(next * 1000) / 1000));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize element tree"
      aria-valuenow={pct(share)}
      aria-valuemin={pct(limits.min)}
      aria-valuemax={pct(limits.max)}
      tabIndex={0}
      className={`omni-split-divider${dragging ? ' is-dragging' : ''}`}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragging) onChange(fromPointer(e.clientX));
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        setDragging(false);
        onCommit(latest.current);
      }}
    >
      <span className="omni-split-divider__grip" aria-hidden="true" />
    </div>
  );
}
```

  In `OmniInspector.tsx`:

```tsx
const splitRef = useRef<HTMLDivElement>(null);
const [split, setSplit] = useState(() => loadSplit(browserStorage()));
const [splitWidth, setSplitWidth] = useState(0);
useEffect(() => {
  const el = splitRef.current;
  if (!el || typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(([entry]) =>
    setSplitWidth(Math.max(0, entry.contentRect.width - DIVIDER_PX)),
  );
  ro.observe(el);
  return () => ro.disconnect();
}, []);
const splitShown = clampSplit(split, splitWidth);
const commitSplit = (s: number) => {
  setSplit(s);
  saveSplit(browserStorage(), s);
};
```

  The tree panel, the divider and the details panel move into `<div className="omni-split" ref={splitRef}>`. The tree panel gets `style={{ flexBasis: \`calc(${splitShown * 100}% - ${splitShown * DIVIDER_PX}px)\` }}`. Between the panels:

```tsx
<SplitDivider
  share={splitShown}
  limits={splitLimits(splitWidth)}
  containerRef={splitRef}
  onChange={setSplit}
  onCommit={commitSplit}
  onReset={() => commitSplit(DEFAULT_SPLIT)}
/>
```

- [ ] **Step 4: CSS.** Delete the embedded 50/50 rules (`.omni-inspector-container.omni-embedded .omni-tree-panel` and `… .omni-details-panel`); they outrank the new ones. Add:

```css
/* ===== Tree | divider | details ===== */
.omni-split {
    flex: 1;
    display: flex;
    min-width: 0;
    min-height: 0;
}

.omni-split > .omni-tree-panel {
    flex: 0 0 auto;
    min-width: 0;
}

.omni-split > .omni-details-panel {
    flex: 1 1 0;
    min-width: 0;
    max-width: none;
}

.omni-split-divider {
    position: relative;
    flex: 0 0 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;
    touch-action: none;
    outline: none;
}

.omni-split-divider::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 5px;
    width: 2px;
    background: transparent;
}

.omni-split-divider:hover::before,
.omni-split-divider.is-dragging::before {
    background: var(--border-strong);
}

.omni-split-divider:focus-visible::before {
    background: var(--color-focus-ring);
}

.omni-split-divider__grip {
    position: relative;
    width: 4px;
    height: 28px;
    border-radius: 2px;
    background: var(--border-strong);
}

.omni-split-divider:hover .omni-split-divider__grip,
.omni-split-divider.is-dragging .omni-split-divider__grip {
    background: var(--text-muted);
}
```

- [ ] **Step 5: Verify** as in Task 5 Step 5.
- [ ] **Step 6: Commit** `feat(omni-vision): resizable tree and details, remembered` (stage the four files).

---

### Task 7: Breadcrumb and wrapped code (TDD)

**Files:**
- Create: `web/src/components/omni-inspector/ElementBreadcrumb.tsx`
- Modify: `web/src/components/omni-inspector/OmniInspector.tsx` (the Info tab's Path row; delete `getElementPath`), `web/src/components/omni-inspector/omni-inspector.css`, `web/src/components/omni-inspector/OmniInspector.test.tsx`

**Interfaces:**
- Consumes: `pathTo`, `shortName` (Task 2); `selectNode` (Task 5).
- Produces: `export default function ElementBreadcrumb(props: { path: InspectorNode[]; onSelect: (node: InspectorNode) => void })`

- [ ] **Step 1: Write the failing test** (the deep fixture: the mic has 5 ancestors):

```tsx
describe('OmniInspector — breadcrumb', () => {
  it('shows the path, folds early ancestors, and selects one when clicked', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search elements' }), {
      target: { value: 'Voice' },
    });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Voice search/ }));
    const nav = screen.getByRole('navigation', { name: 'Element path' });
    expect(within(nav).getByText('Voice search')).toHaveAttribute('aria-current', 'location');
    // hierarchy, level1…level4: five ancestors, so the first one folds away.
    expect(within(nav).queryByRole('button', { name: 'hierarchy' })).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: 'Show all 5 ancestors' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'hierarchy' }));
    expect(screen.getByRole('treeitem', { name: /hierarchy/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `ElementBreadcrumb.tsx`:

```tsx
import React, { useState } from 'react';
import type { InspectorNode } from './OmniInspector';
import { shortName } from './treeRows';

const SHOWN_ANCESTORS = 4;

/**
 * The selected node's ancestors, root first, each selectable. It is also how
 * the keyboard reaches a node in the middle of a folded tree row. Render it
 * with `key` set to the node's xpath so "show all" resets per selection.
 */
export default function ElementBreadcrumb({
  path,
  onSelect,
}: {
  path: InspectorNode[];
  onSelect: (node: InspectorNode) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!path.length) return null;
  const node = path[path.length - 1];
  const ancestors = path.slice(0, -1);
  const hidden = !showAll && ancestors.length > SHOWN_ANCESTORS ? ancestors.length - SHOWN_ANCESTORS : 0;
  return (
    <nav aria-label="Element path" className="omni-crumbs">
      <ol>
        {hidden > 0 && (
          <li>
            <button
              type="button"
              className="omni-crumb"
              aria-label={`Show all ${ancestors.length} ancestors`}
              onClick={() => setShowAll(true)}
            >
              …
            </button>
          </li>
        )}
        {ancestors.slice(hidden).map((n) => (
          <li key={n.xpath}>
            <button type="button" className="omni-crumb" title={n.type} onClick={() => onSelect(n)}>
              {shortName(n)}
            </button>
          </li>
        ))}
        <li>
          <span className="omni-crumb is-current" aria-current="location" title={node.type}>
            {shortName(node)}
          </span>
        </li>
      </ol>
    </nav>
  );
}
```

  In `OmniInspector.tsx`, the Info tab's Path row:

```tsx
<div className="omni-info-row omni-info-row--path">
  <span className="omni-info-key">Path</span>
  <ElementBreadcrumb
    key={selectedNode.xpath}
    path={(snapshot?.hierarchy && pathTo(snapshot.hierarchy, selectedNode.xpath)) || [selectedNode]}
    onSelect={selectNode}
  />
</div>
```

  Delete `getElementPath`.

- [ ] **Step 4: CSS:**

```css
/* ===== Element path (ElementBreadcrumb.tsx) ===== */
.omni-crumbs ol {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 0;
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 0;
}

.omni-crumbs li {
    display: flex;
    align-items: center;
    min-width: 0;
}

.omni-crumbs li + li::before {
    content: '›';
    padding: 0 4px;
    color: var(--text-dim);
}

.omni-crumb {
    max-width: 16ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 4px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
}

.omni-crumb:hover {
    background: rgb(var(--rgb-fg) / 0.06);
    color: var(--text);
}

.omni-crumb:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
}

.omni-crumb.is-current {
    color: var(--text);
    font-weight: 600;
    cursor: default;
}
```

  And the code block wraps: in `.omni-codegen-pre`, `white-space: pre-wrap; overflow-wrap: anywhere;` replace `white-space: pre;` (leave the rest, including its existing colour literals, untouched).

- [ ] **Step 5: Verify** as in Task 5 Step 5.
- [ ] **Step 6: Commit** `feat(omni-vision): element path breadcrumb; generated code wraps` (stage the four files).

---

### Task 8: Verify live and open the PR

- [ ] **Build:** from the repo root, `npm run build:xenon && npm run build:copy`.
- [ ] **Live on the S9+** (Playwright scripts in the scratchpad; the dashboard at `http://127.0.0.1:4723/xenon/devices/381103b720057ece/control/omni`), 1280×800 and 1440×900, dark and light:
  - Expand all; count cut target names (`.omni-tree-row__part.is-target` with `scrollWidth > clientWidth`): 48 before; the target is none of 24 characters or fewer at 1280 with the default split. Report the count and the longest cut name.
  - No sideways scroll: `.omni-tree-content` and `.omni-codegen-pre` have `scrollWidth <= clientWidth`.
  - Keyboard walk: focus the tree, ↓ to the end, then ← back to the top; every step lands on a `treeitem`.
  - In Inspect mode, click the Voice search mic on the phone after Collapse all; its row appears, selected and in view.
  - Divider: drag to 55%, reload, still 55%; Home/End reach 240 px and 340 px; double-click returns to 40%.
  - Contrast of the row text, type, count, guides' neighbours, match colour, breadcrumb and hint against their backgrounds (≥ 4.5:1 for text).
  - Screenshots in both themes for the PR.
- [ ] **Viewport suite:** `cd web && npm run test:viewport` → passes.
- [ ] **Threshold-0 harness** (`scratchpad/dcshots`): the Screenshot and Logs tabs unchanged (26 captures).
- [ ] **Lint and suite:** web suite, `tsc`, lint counts.
- [ ] **Push and open the PR** with `--body-file`; bind it; report.
