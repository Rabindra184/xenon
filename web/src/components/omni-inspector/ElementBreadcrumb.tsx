import React, { useState } from 'react';
import type { InspectorNode } from './OmniInspector';
import { shortName } from './treeRows';

const SHOWN_ANCESTORS = 4;

/**
 * The selected node's ancestors, root first, then the node itself. It is also
 * how the keyboard reaches a node in the middle of a folded tree row. Render
 * it with `key` set to the node's xpath so "show all" resets per selection.
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
        {ancestors.slice(hidden).map((n) => (
          <li key={n.xpath}>
            <button
              type="button"
              className="omni-crumb"
              title={n.type}
              aria-label={shortName(n)}
              onClick={() => onSelect(n)}
            >
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
