import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { InspectorNode } from './OmniInspector';
import { nodeTooltip, rowIndexOf, shortName, shortType, type Row } from './treeRows';
import { treeKeyAction } from './treeKeys';
import { analyzeElement, ROLE_ICON } from './elementRole';

const INDENT_PX = 10;

interface ElementTreeProps {
  rows: Row[];
  selectedXpath: string | null;
  hoveredXpath: string | null;
  matches: ReadonlySet<string>;
  onToggle: (xpath: string) => void;
  onSelect: (node: InspectorNode) => void;
  onHover: (node: InspectorNode | null) => void;
  /**
   * Bumped by the host whenever the selected row must be shown again, even if
   * the selection itself didn't change (a cleared search, a new capture, the
   * same node picked on the phone after its row was closed).
   */
  revealSeq?: number;
}

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
  revealSeq = 0,
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
    // The browser would scroll on focus with its own alignment; the tree
    // scrolls itself, to the nearest edge.
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'nearest' });
  };

  // Scroll a newly selected node's row into view once it exists: the host
  // opens the rows on the way to it, so it may appear a render later.
  useEffect(() => {
    pendingReveal.current = selectedXpath;
  }, [selectedXpath, revealSeq]);
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
    if (lost && i >= 0) rowEl(i)?.focus({ preventScroll: true });
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
    if (treeRef.current?.contains(e.relatedTarget as Node | null)) return;
    onHover(null);
    // Focus left the tree, so the selection may change by another route (the
    // phone, the breadcrumb) before it comes back: the tab stop follows the
    // selection again instead of the row that was left.
    setFocusKey(null);
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
        const showType = !!type && type !== name;
        // An explicit name: the row's visible content is a run of parts plus
        // icons, separators and a muted type/count, and per-part `title`
        // tooltips make content-based name computation unreliable (some
        // accessible-name implementations resolve a title before descending
        // into content). aria-label keeps the row's name equal to what it
        // shows, independent of that markup — joined in plain words, not the
        // "›" glyph, which is decorative (aria-hidden) and reads unpredictably.
        const runNames = row.nodes.map((n) => shortName(n)).join(', ');
        const ariaLabel = showType ? `${runNames}, ${type}` : runNames;
        // Held open by the search: the caret can't close it (Row.collapsible).
        const locked = row.expanded && !row.collapsible;
        const partClass = (n: InspectorNode, isTarget: boolean) =>
          `omni-tree-row__part${isTarget ? ' is-target' : ''}${
            matches.has(n.xpath) ? ' is-match' : ''
          }${n.xpath === selectedXpath ? ' is-current' : ''}`;
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
            aria-label={ariaLabel}
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
            {/* Lead, label, count: see "Element tree" in omni-inspector.css. */}
            <span className="omni-tree-row__lead" aria-hidden="true">
              <span
                className="omni-tree-row__indent"
                style={{ width: (row.level - 1) * INDENT_PX }}
              />
              <span
                className={`omni-tree-row__caret${locked ? ' is-locked' : ''}`}
                onClick={
                  row.hasChildren
                    ? (e) => {
                        e.stopPropagation();
                        if (!locked) onToggle(row.key);
                      }
                    : undefined
                }
              >
                {row.hasChildren &&
                  (row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
              </span>
              <span className="omni-tree-row__icon">{ROLE_ICON[analyzeElement(target).key]}</span>
            </span>
            <span className="omni-tree-row__label">
              {row.nodes.length > 1 && (
                <span className="omni-tree-row__head">
                  {row.nodes.slice(0, -1).map((n) => (
                    // A part and its "›" go together, so the separator
                    // disappears with its part rather than before it.
                    <span key={n.xpath} className="omni-tree-row__step">
                      <span
                        className={partClass(n, false)}
                        title={nodeTooltip(n)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(n);
                        }}
                        onMouseEnter={() => onHover(n)}
                        onMouseLeave={() => onHover(target)}
                      >
                        {shortName(n)}
                      </span>
                      <span className="omni-tree-row__sep" aria-hidden="true">
                        ›
                      </span>
                    </span>
                  ))}
                </span>
              )}
              <span className="omni-tree-row__tail">
                <span className={partClass(target, true)} title={nodeTooltip(target)}>
                  {shortName(target)}
                </span>
                {showType && <span className="omni-tree-row__type">{type}</span>}
              </span>
            </span>
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
