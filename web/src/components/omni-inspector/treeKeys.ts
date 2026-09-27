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
      // A row the search holds open can't close, so ← goes up instead.
      if (row.collapsible) return { toggle: row.key };
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
