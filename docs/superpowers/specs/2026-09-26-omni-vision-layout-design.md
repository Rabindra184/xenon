# Omni-Vision: layout, compact tree, keyboard — design

Date: 2026-09-26
Status: approved in brainstorming ("go"). Second of two Omni-Vision PRs; the
first (#331) added Checks, the stale-capture notice and the refresh race guard.

## Why

Measured live on the lab Galaxy S9+ home screen (66 elements) at 1280×800,
dark theme, with the dashboard built from main at 7f16287:

- **The tree cuts off its own names.** With everything expanded, 48 of 66
  names are truncated, and the deepest rows read "C" or "Rela…". The tree is
  19 levels deep and indents 14 px a level, so the deepest row spends 266 px of
  a 408 px panel on indentation. The panel also scrolls sideways.
- **Much of the depth is wrappers.** 26 of the 66 elements are the only child
  of their parent (hierarchy › FrameLayout › LinearLayout › content).
- **Rows are tall.** About 38 px each, so about 13 of the 66 fit.
- **Names are long.** Resource ids carry the package:
  `com.sec.android.app.launcher:id/scrim_view`.
- **The keyboard can't reach the tree.** 0 of 66 rows can take focus, and
  nothing tells a screen reader it is a tree.
- **A selection can be hidden.** Picking an element on the phone in Inspect
  mode, or from search and then clearing it, leaves the tree collapsed around
  it.
- **Code gen hides the line that matters.** `driver.findElement(AppiumBy.ac…`
  is cut off behind a sideways scroll.
- **The search placeholder is cut off:** "(try 'login button' or 'text fie".
- **The split is fixed at 50/50** (410 px each at 1280), though the tree and
  the details need width at different times.

Decisions made in brainstorming:

| Question | Decision |
|---|---|
| Layout | **A: side by side, compact tree.** Tree and details stay beside each other, with a draggable divider. Rejected: B (stacked, full width), which halves each pane's height to about 300 px; C (details first, tree in a drawer), which hides the tree while you read details. |

## Behaviour

### Layout and divider

- The Omni-Vision tab keeps the tree on the left and the details on the
  right, with a divider between them. (The standalone mode, which nothing
  renders today, keeps its screenshot panel and gets the same divider.)
- The tree's share is a fraction of the row's width. The default is **0.4**:
  at 1280×800 the interactions column is 840 px wide, so the tree gets about
  330 px and the details about 500 px.
- Limits: the tree keeps at least **240 px** and the details at least
  **340 px**. A stored or dragged value outside them is clamped. When the row
  is too narrow for both minimums, the tree gets its minimum and the details
  the rest.
- The divider:
  - is `role="separator"`, `aria-orientation="vertical"`,
    `aria-label="Resize element tree"`, with `aria-valuenow` (the tree's share
    as a whole percentage), `aria-valuemin` and `aria-valuemax` (the clamped
    limits as percentages), and `tabIndex=0`;
  - moves with the mouse (pointer capture, so a drag that leaves the divider
    keeps working);
  - moves **2 percentage points** per ← or → press; **Home** and **End** jump
    to the limits;
  - resets to 0.4 on double-click;
  - is 12 px wide, the same as the gap it replaces, and all of it is the hit
    area; the cursor is `col-resize`;
  - at rest shows a 4×28 px grip in `--text-dim` (first `--border-strong`,
    raised for 3:1 non-text contrast), centred vertically; on
    hover or drag a full-height 2 px line in `--border-strong` appears and the
    grip turns `--text-muted`; on keyboard focus (`:focus-visible`) the line
    is `--color-focus-ring`.
- The share is stored in `localStorage['xenon.omni.split']` on release (not on
  every move). Reads and writes are wrapped in try/catch, and a missing,
  unparsable or out-of-range value falls back to 0.4.

### Tree header

- The header keeps its title "Source" and its four buttons (Expand all,
  Collapse all, Inspect/Interact mode, Refresh snapshot).
- The element count and the source badge move to the line under the header,
  which already holds the capture age: **"66 elements · Device · Captured 12 s
  ago"**. "Device" / "Session" keeps its tooltip. While the capture is stale,
  that line is the stale notice from #331, unchanged.

### Rows

- **Height 26 px.** At 1280×800 about 19 rows fit where 13 did.
- **Wrapper runs share a row.** A node folds into its only child when it is a
  plain wrapper: it has exactly one child, is not interactive (the
  `isInteractive` rule from #331) and has no text, content-desc or label. The
  run continues down while each node is a plain wrapper. The last node of the
  run may be anything.
  - On the S9+ home screen this makes 66 rows into 45 and the depth 19 into
    9; the longest run is 5 nodes.
  - The row shows each node's short name, separated by "›":
    "FrameLayout › LinearLayout › content".
  - Each part is clickable and selects its node. Clicking elsewhere on the row
    selects the row's **target**, its last node.
  - When the row is short of room, earlier parts shrink and ellipsize first;
    the target's part shrinks last.
  - The row's children are the target's children, and its open or closed
    state is the target's.
- **Indent 10 px a level,** with a 1 px guide line in `--border` for each
  ancestor level.
- **Name** (for each part): the first non-empty of text, content-desc, label,
  the resource id without its package (`scrim_view`; `android:id/content`
  becomes `content`), the iOS `name` attribute (its accessibility
  identifier), then the type's last segment (`FrameLayout`). `node.name` is
  not used: on Android the server fills it from the resource id, text or
  type, so it is never empty.
- **After the name**, in muted text, the type's last segment, when the name
  isn't already the type. Only the target's type is shown on a folded row.
- **What gives way first** when a row is short of room: the earlier parts of
  a run, then the muted type, then the target's name, each ending in "…".
- **Icon:** the role icon of the target (`analyzeElement` + `ROLE_ICON` from
  #331) replaces the generic cube.
- **Child count** shows only on collapsed rows.
- **Tooltip** (`title`) on each part: the full type, the full resource id and
  the text, those that exist, one per line.
- **Hover** on a part or row outlines that node on the phone, as today.
- The expand arrow is drawn by the row and is not a button: clicking it
  toggles the row, and it is `aria-hidden`. A button nested in a tree item is
  a nested interactive control; the keyboard uses → and ← instead.

### Keyboard and screen readers

The WAI-ARIA tree pattern, flat form:

- The row list is `role="tree"`, `aria-label="Element tree"`.
- Each row is `role="treeitem"` with `aria-level` (1-based), `aria-setsize`,
  `aria-posinset`, `aria-selected` (true when the selected node is any node of
  the row), and `aria-expanded` when its target has children.
- **One tab stop** (roving `tabIndex`): the focused row has 0, others −1. When
  the tree gains focus without a focused row, focus goes to the selected row,
  else the first row.
- Keys, on the focused row:

  | Key | Action |
  |---|---|
  | ↓ / ↑ | Next / previous visible row. Stops at the ends. |
  | → | Closed row with children: open it. Open row: move to its first child. Leaf: nothing. |
  | ← | Open row: close it. Otherwise move to its parent row. Top row: nothing. |
  | Home / End | First / last visible row |
  | Enter / Space | Select the row's target and show Info |

- Moving focus outlines the focused row's target on the phone, the same as
  hover, and scrolls the row into view (`block: 'nearest'`). Leaving the tree
  clears that outline.
- Key handling calls `preventDefault` only for the keys above, so Tab and
  typing still work.

### The selection is always visible

When the selected node changes and its row is not visible (selected on the
phone in Inspect mode, from search, from the breadcrumb, or after a search is
cleared), every row on the way to it opens, and its row scrolls into view
(`block: 'nearest'`). Opening means adding every ancestor's xpath to the open
set; since a row's state is its target's, and every target on the way is an
ancestor, that opens exactly the rows on the way. Rows the user opened or
closed elsewhere keep their state.

### Search

- The placeholder is "Search elements".
- While a query is typed, the hint under the box reads **"N matches · try a
  role: button, input, image"** ("1 match", "No matches"). N counts nodes that
  match, not rows.
- A folded row shows while searching if any of its nodes matches or leads to
  a match; the matching parts are shown in `--color-highlight` text.
- The search rules (`smartSearch`) are unchanged.

### Initial expansion

After a capture loads, rows at levels 1 to 3 are open, counted in rows after
folding. Today the raw tree's first three levels open, which on Android is
mostly wrappers, so the same rule now shows more of the screen.

### Details

- **Breadcrumb.** Info's "Path" row becomes a breadcrumb of the selected
  node's ancestors, root first, then the node itself:
  - each ancestor is a button (its short name, full type in `title`) that
    selects it; the node itself is plain text with `aria-current="location"`;
  - with more than 4 ancestors, the earlier ones collapse into one "…" button
    (`aria-label="Show all 12 ancestors"`) that expands the breadcrumb in
    place, until the selection changes;
  - it is a `nav` with `aria-label="Element path"`.
  This is also how the keyboard reaches a node in the middle of a folded row.
- **Code gen wraps.** The code block uses `white-space: pre-wrap` and
  `overflow-wrap: anywhere`, so it never scrolls sideways. Copy still copies
  the exact code.

## Code

| File | Change |
|---|---|
| `omni-inspector/elementRole.tsx` (new) | `RoleKey`, `analyzeElement`, `ROLE_ICON`, moved verbatim from `OmniInspector.tsx` and exported |
| `omni-inspector/treeRows.ts` (new, pure) | `shortName(node)`, `shortResourceId(id)`, `isPlainWrapper(node)`, `foldRun(node)` (the run from a node), `smartSearch` (moved verbatim), `matchSet(root, query)` (xpaths that match) and `pathToMatch(root, query)` (xpaths leading to one), `visibleRows(root, expanded, query)` (flat rows), `initialExpanded(root)`, `pathTo(root, xpath)` (root first, ending with the node; `null` if absent), `rowIndexOf(rows, xpath)` (the row holding that node, or −1) |
| `omni-inspector/treeKeys.ts` (new, pure) | `treeKeyAction(rows, index, key)` → `{ focus?: number; toggle?: string; select?: InspectorNode } \| null` |
| `omni-inspector/splitPane.ts` (new, pure) | `DEFAULT_SPLIT`, `MIN_TREE_PX`, `MIN_DETAILS_PX`, `clampSplit(share, width)`, `splitLimits(width)`, `loadSplit(storage)`, `saveSplit(storage, share)` |
| `omni-inspector/ElementTree.tsx` (new) | The rows (not the header): roving focus, keys, and scrolling the selected row into view when `selectedXpath` changes. Props: `rows`, `selectedXpath`, `query`, `onToggle(xpath)`, `onSelect(node)`, `onHover(node \| null)` |
| `omni-inspector/SplitDivider.tsx` (new) | The divider, controlled: `share`, `limits`, `onChange(share)`, `onCommit(share)`, `onReset()` |
| `omni-inspector/ElementBreadcrumb.tsx` (new) | The breadcrumb: `ancestors`, `node`, `onSelect(node)` |
| `omni-inspector/OmniInspector.tsx` | Uses the above; `renderTree`, the `searchOpen` memo and `getElementPath` go; the reveal effect; the meta line; the placeholder and hint |
| `omni-inspector/omni-inspector.css` | New `omni-tree-row*`, `omni-split*`, `omni-crumb*` rules; the old `.tree-*` rules and `.omni-count-badge` go (only Omni used them); `.omni-codegen-pre` wraps. Tokens only. |

`Row`, as `visibleRows` returns it:

```ts
interface Row {
  key: string;            // the target's xpath
  nodes: InspectorNode[]; // the run, top first; the last is the target
  level: number;          // 1-based
  setSize: number;
  posInSet: number;
  hasChildren: boolean;   // the target has children
  expanded: boolean;      // the target is open (or held open by search)
  parentKey: string | null;
}
```

## Error handling

- Storage that throws or holds junk: the divider uses 0.4 and keeps working;
  a failed save is ignored.
- A snapshot with no hierarchy renders the existing empty state; `visibleRows`
  returns `[]` for a missing root.
- **After a new capture, the selection follows the xpath.** It moves to the
  node with the same xpath in the new capture, which the reveal then shows,
  and clears if there is none. Today it keeps the old capture's node object,
  so after Refresh the Info tab still shows the old screen's text and bounds.
- A focused row that disappears (collapsed away by its parent, or a new
  capture) moves focus to the nearest remaining row, or to the tree.

## Testing

TDD: each test is written first and watched fail.

- `treeRows.test.ts`:
  - `shortResourceId` strips the package; `shortName` priority;
  - a run folds plain wrappers and stops at an interactive or named node;
    a clickable wrapper with one child does not fold;
  - `visibleRows` levels, set size and position, closed rows hide children,
    a folded row's children are its target's;
  - search keeps rows that match or lead to a match, opened;
  - `initialExpanded` opens three row levels;
  - `pathTo` returns the path root first, `[root]` for the root and `null`
    for an unknown xpath; `rowIndexOf` finds a node in the middle of a run.
- `treeKeys.test.ts`: every row of the key table, including the ends and a
  folded row.
- `splitPane.test.ts`: clamping at both limits, a row too narrow for both,
  junk and throwing storage.
- `OmniInspector.test.tsx` (real render, API mocked):
  - `role="tree"` with treeitems carrying level, set size and position;
  - ↓, →, ← move focus and open or close rows; Enter selects and Info shows
    the element;
  - a breadcrumb click selects an ancestor; selecting a deep node from the
    breadcrumb's "…" and from search reveals its row (opened, present);
  - the divider's ← → Home End change `aria-valuenow` and double-click
    resets it;
  - the search hint counts matches;
  - after Refresh the selection is the new capture's node with the same
    xpath (its new text shows in Info), and clears when there is none;
  - the #331 tests keep passing.
- Live on the S9+, built dashboard, 1280×800 and 1440×900, dark and light:
  - cut-off names with everything expanded: 48 today. The target, at
    1280×800 with the default split: no target name of 24 characters or
    fewer is cut, at any depth. Longer names end in "…" with the full name in
    the tooltip;
  - no sideways scroll in the tree or Code gen;
  - a keyboard walk through the whole tree (↓ to the end, ← back up);
  - selecting an element on the phone in Inspect mode reveals its row;
  - the divider drags, keys and persists across a reload;
  - contrast of every new text and line against its background.
- The viewport suite (device-control route) passes; the threshold-0 harness
  shows the Screenshot and Logs tabs unchanged.

## Not in this PR

- Rendering only the visible rows. 45 to a few hundred rows render fine.
- The phone preview's size.
- Type-ahead in the tree.
