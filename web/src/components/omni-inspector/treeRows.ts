import type { InspectorNode } from './OmniInspector';
import { isInteractive } from './elementChecks';

// =====================================================================
// Row interface
// =====================================================================
export interface Row {
  /** the target's xpath */
  key: string;
  /** the run, top first; the last is the target */
  nodes: InspectorNode[];
  /** 1-based */
  level: number;
  setSize: number;
  posInSet: number;
  /** the target has children */
  hasChildren: boolean;
  /** the target is open, or held open by search */
  expanded: boolean;
  /**
   * Open, and closing it would close it: false for a row the search holds
   * open (toggling the open set would change nothing on screen, then flip the
   * row once the search is cleared), and for a closed row or a leaf.
   */
  collapsible: boolean;
  parentKey: string | null;
}

// =====================================================================
// Search: plain-language matching over types, text and ids
// =====================================================================
export function smartSearch(node: InspectorNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();

  // Semantic role mappings
  const semanticMap: Record<string, string[]> = {
    button: ['button', 'btn', 'clickable', 'tapable'],
    input: ['edittext', 'input', 'field', 'textfield', 'textinput', 'edit'],
    image: ['image', 'imageview', 'img', 'picture', 'photo', 'icon'],
    text: ['textview', 'label', 'text', 'statictext'],
    list: ['listview', 'recyclerview', 'scrollview', 'tableview', 'collectionview', 'scroll'],
    toggle: ['switch', 'checkbox', 'toggle', 'radiobutton'],
    nav: ['toolbar', 'navigationbar', 'tabbar', 'actionbar', 'navbar'],
  };

  const typeStr = (node.type || '').toLowerCase();
  const textStr = (node.text || node.label || node.value || '').toLowerCase();
  const nameStr = (node.name || '').toLowerCase();
  const attrsStr = Object.values(node.attributes || {})
    .join(' ')
    .toLowerCase();

  // Check semantic aliases
  for (const [alias, variants] of Object.entries(semanticMap)) {
    if (q.includes(alias) && variants.some((v) => typeStr.includes(v))) {
      return true;
    }
  }

  // Direct match on type, text, name, or attributes
  return typeStr.includes(q) || textStr.includes(q) || nameStr.includes(q) || attrsStr.includes(q);
}

// =====================================================================
// Naming functions
// =====================================================================

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

/** The full type, resource id and text, those that exist, one per line. */
export function nodeTooltip(node: InspectorNode): string {
  return [node.type, node.attributes?.['resource-id'], node.text]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join('\n');
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

// =====================================================================
// Matching and search
// =====================================================================

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

// =====================================================================
// Row generation and traversal
// =====================================================================

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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    !searching || run.some((n) => matches!.has(n.xpath) || leads!.has(n.xpath));
  const out: Row[] = [];
  const emit = (siblings: InspectorNode[], level: number, parentKey: string | null) => {
    const runs = siblings.map(foldRun).filter(shows);
    runs.forEach((run, i) => {
      const target = run[run.length - 1];
      const hasChildren = (target.children?.length ?? 0) > 0;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const heldBySearch = searching && leads!.has(target.xpath);
      const expandedNow = hasChildren && (expanded.has(target.xpath) || heldBySearch);
      out.push({
        key: target.xpath,
        nodes: run,
        level,
        setSize: runs.length,
        posInSet: i + 1,
        hasChildren,
        expanded: expandedNow,
        collapsible: expandedNow && !heldBySearch,
        parentKey,
      });
      if (expandedNow) emit(target.children, level + 1, target.xpath);
    });
  };
  emit([root], 1, null);
  return out;
}

/** The rows open after a capture: the first `levels` row levels. */
export function initialExpanded(root: InspectorNode | null | undefined, levels = 3): Set<string> {
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
