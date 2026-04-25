import type { InspectorNode } from './OmniInspector';

export type MatchKind = 'matched' | 'unsupported';

export interface MatchResult {
  kind: MatchKind;
  nodes: InspectorNode[];
  reason?: string;
}

function walk(root: InspectorNode, visit: (n: InspectorNode) => void): void {
  visit(root);
  root.children?.forEach((c) => walk(c, visit));
}

function attr(n: InspectorNode, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = n.attributes?.[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return undefined;
}

function shortType(n: InspectorNode): string {
  return n.type?.split('.').pop() || n.type || '';
}

function matchAccessibilityId(root: InspectorNode, value: string): InspectorNode[] {
  const out: InspectorNode[] = [];
  walk(root, (n) => {
    const aid = attr(n, 'content-desc', 'contentDescription', 'accessibilityId', 'name', 'label');
    if (aid === value) out.push(n);
  });
  return out;
}

function matchId(root: InspectorNode, value: string): InspectorNode[] {
  const out: InspectorNode[] = [];
  walk(root, (n) => {
    const id = attr(n, 'resource-id', 'resourceId', 'identifier');
    if (id === value) out.push(n);
  });
  return out;
}

function matchClassName(root: InspectorNode, value: string): InspectorNode[] {
  const out: InspectorNode[] = [];
  walk(root, (n) => {
    if (n.type === value || shortType(n) === value) out.push(n);
  });
  return out;
}

function matchName(root: InspectorNode, value: string): InspectorNode[] {
  const out: InspectorNode[] = [];
  walk(root, (n) => {
    if (attr(n, 'name') === value) out.push(n);
  });
  return out;
}

// Parses simple `//Tag[@attr="val"]` and `//*[@attr="val"]` patterns.
// Returns null if the xpath is anything more complex (unions, axes, predicates with logic).
interface SimpleXpathPredicate {
  tag: string | null; // null = any
  attrKey: string;
  attrValue: string;
}

function parseSimpleAttributeXpath(xpath: string): SimpleXpathPredicate | null {
  const m = /^\/\/(\*|[A-Za-z_][\w.-]*)\[@([\w-]+)=(["'])(.*?)\3\]$/.exec(xpath.trim());
  if (!m) return null;
  return {
    tag: m[1] === '*' ? null : m[1],
    attrKey: m[2],
    attrValue: m[4],
  };
}

// Walks the tree following a positional xpath segment-by-segment.
// Expects format: /Type[1]/Type[2]/... (the form InspectorService now generates)
function matchPositionalXpath(root: InspectorNode, xpath: string): InspectorNode[] | null {
  const segments = xpath.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Validate every segment is Type[index]
  const parsed: Array<{ type: string; index: number }> = [];
  for (const seg of segments) {
    const m = /^([A-Za-z_][\w.-]*)\[(\d+)\]$/.exec(seg);
    if (!m) return null;
    parsed.push({ type: m[1], index: parseInt(m[2], 10) });
  }

  // First segment must match the root's type
  if (parsed[0].type !== root.type && parsed[0].type !== shortType(root)) return null;
  if (parsed[0].index !== 1) return null;

  let current: InspectorNode | undefined = root;
  for (let i = 1; i < parsed.length && current; i++) {
    const { type, index } = parsed[i];
    let seen = 0;
    let next: InspectorNode | undefined;
    for (const child of current.children || []) {
      if (child.type === type || shortType(child) === type) {
        seen += 1;
        if (seen === index) {
          next = child;
          break;
        }
      }
    }
    current = next;
  }

  return current ? [current] : [];
}

function matchXpath(root: InspectorNode, value: string): MatchResult {
  const positional = matchPositionalXpath(root, value);
  if (positional !== null) return { kind: 'matched', nodes: positional };

  const simple = parseSimpleAttributeXpath(value);
  if (simple) {
    const out: InspectorNode[] = [];
    walk(root, (n) => {
      if (simple.tag && n.type !== simple.tag && shortType(n) !== simple.tag) return;
      const have = attr(n, simple.attrKey);
      if (have === simple.attrValue) out.push(n);
    });
    return { kind: 'matched', nodes: out };
  }

  return {
    kind: 'unsupported',
    nodes: [],
    reason: 'Complex XPath (axes, multiple predicates, functions) — use a real driver to verify',
  };
}

// Parses simple iOS class chain like `**/XCUIElementTypeButton[`label == "Done"`]`
// or `**/XCUIElementTypeOther[1]`. Returns null for anything multi-segment or complex.
function matchIosClassChain(root: InspectorNode, value: string): MatchResult {
  const trimmed = value.trim();
  // **/Type[`attr == "val"`]
  const pred = /^\*\*\/([A-Za-z_]\w*)\[`(\w+)\s*==\s*"([^"]*)"`\]$/.exec(trimmed);
  if (pred) {
    const [, type, attrKey, attrValue] = pred;
    const out: InspectorNode[] = [];
    walk(root, (n) => {
      if (n.type !== type && shortType(n) !== type) return;
      const have = attr(n, attrKey);
      if (have === attrValue) out.push(n);
    });
    return { kind: 'matched', nodes: out };
  }
  // **/Type[N]
  const idx = /^\*\*\/([A-Za-z_]\w*)\[(\d+)\]$/.exec(trimmed);
  if (idx) {
    const [, type, nStr] = idx;
    const n = parseInt(nStr, 10);
    const all: InspectorNode[] = [];
    walk(root, (cn) => {
      if (cn.type === type || shortType(cn) === type) all.push(cn);
    });
    return { kind: 'matched', nodes: all[n - 1] ? [all[n - 1]] : [] };
  }
  // **/Type
  const any = /^\*\*\/([A-Za-z_]\w*)$/.exec(trimmed);
  if (any) return matchClassName(root, any[1]).length > 0
    ? { kind: 'matched', nodes: matchClassName(root, any[1]) }
    : { kind: 'matched', nodes: [] };

  return {
    kind: 'unsupported',
    nodes: [],
    reason: 'Multi-segment class chain — use a real driver to verify',
  };
}

// Parses simple iOS NSPredicate like `type == "X"` or `label == "Y"` or `type == "X" AND label == "Y"`.
function matchIosPredicate(root: InspectorNode, value: string): MatchResult {
  const trimmed = value.trim();
  const parts = trimmed.split(/\s+AND\s+/i).map((p) => p.trim());
  type Term = { key: string; value: string };
  const terms: Term[] = [];
  for (const part of parts) {
    const m = /^(\w+)\s*==\s*"([^"]*)"$/.exec(part);
    if (!m) {
      return {
        kind: 'unsupported',
        nodes: [],
        reason: 'Predicate uses unsupported operator (only ==, AND) — use a real driver',
      };
    }
    terms.push({ key: m[1], value: m[2] });
  }
  const out: InspectorNode[] = [];
  walk(root, (n) => {
    for (const t of terms) {
      let have: string | undefined;
      if (t.key === 'type') have = n.type;
      else if (t.key === 'label') have = attr(n, 'label') ?? n.label;
      else if (t.key === 'name') have = attr(n, 'name') ?? n.name;
      else if (t.key === 'value') have = attr(n, 'value') ?? n.value;
      else have = attr(n, t.key);
      if (have !== t.value) return;
    }
    out.push(n);
  });
  return { kind: 'matched', nodes: out };
}

export function matchSelector(
  root: InspectorNode,
  strategy: string,
  value: string,
): MatchResult {
  const s = strategy.toLowerCase();
  if (!value) return { kind: 'matched', nodes: [] };

  switch (s) {
    case 'accessibility id':
      return { kind: 'matched', nodes: matchAccessibilityId(root, value) };
    case 'id':
      return { kind: 'matched', nodes: matchId(root, value) };
    case 'class name':
      return { kind: 'matched', nodes: matchClassName(root, value) };
    case 'name':
      return { kind: 'matched', nodes: matchName(root, value) };
    case 'xpath':
      return matchXpath(root, value);
    case '-ios class chain':
      return matchIosClassChain(root, value);
    case '-ios predicate string':
      return matchIosPredicate(root, value);
    default:
      return {
        kind: 'unsupported',
        nodes: [],
        reason: `Strategy "${strategy}" not yet supported by snapshot matcher`,
      };
  }
}
