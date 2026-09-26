import React, { useEffect, useRef, useState } from 'react';
import type { InspectorNode } from './OmniInspector';
import { nodeTooltip, shortName } from './treeRows';

const SHOWN_ANCESTORS = 4;

/**
 * The selected node's ancestors, root first, then the node itself. It is also
 * how the keyboard reaches a node in the middle of a folded tree row. Render
 * it with `key` set to the node's xpath so "show all" resets per selection.
 */
export default function ElementBreadcrumb({
  path,
  onSelect,
  focusCurrent = false,
}: {
  path: InspectorNode[];
  onSelect: (node: InspectorNode) => void;
  /**
   * The selection came from one of this breadcrumb's crumbs. That crumb
   * turns into the current one as the breadcrumb remounts for the new node,
   * so focus goes to the current crumb rather than falling to <body>.
   */
  focusCurrent?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  const currentRef = useRef<HTMLSpanElement>(null);

  // On mount only: focusCurrent says how this selection was made.
  useEffect(() => {
    if (focusCurrent) currentRef.current?.focus();
  }, []);

  // "…" removes itself; focus goes to the first ancestor it revealed.
  useEffect(() => {
    if (showAll) firstRef.current?.focus();
  }, [showAll]);

  if (!path.length) return null;
  const node = path[path.length - 1];
  const ancestors = path.slice(0, -1);
  const hidden =
    !showAll && ancestors.length > SHOWN_ANCESTORS ? ancestors.length - SHOWN_ANCESTORS : 0;
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
        {ancestors.slice(hidden).map((n, i) => (
          <li key={n.xpath}>
            <button
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="omni-crumb"
              title={nodeTooltip(n)}
              aria-label={shortName(n)}
              onClick={() => onSelect(n)}
            >
              {shortName(n)}
            </button>
          </li>
        ))}
        <li>
          <span
            ref={currentRef}
            tabIndex={-1}
            className="omni-crumb is-current"
            aria-current="location"
            title={nodeTooltip(node)}
          >
            {shortName(node)}
          </span>
        </li>
      </ol>
    </nav>
  );
}
