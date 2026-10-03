import type { LogRecordLike } from './logcatFilter';
import { formatLine } from './logcatRecording';

/**
 * Which log lines are selected, kept by `seq`.
 *
 * Not by position: the buffer drops its oldest lines from the front, which
 * shifts every position, while a line's `seq` never changes. So a selection
 * survives the buffer moving under it, and a filter hiding a selected line
 * only hides it.
 *
 * - `selected`: every selected line.
 * - `anchor`: where a Shift range starts (the last line clicked or moved to
 *   without Shift).
 * - `active`: the line the keyboard is on, and the one the details panel
 *   shows.
 */
export interface LogSelection {
  selected: ReadonlySet<number>;
  anchor: number | null;
  active: number | null;
}

export const NO_SELECTION: LogSelection = { selected: new Set(), anchor: null, active: null };

/** Shift (a range) and Cmd or Ctrl (add or remove one line). */
export interface ClickKeys {
  range: boolean;
  toggle: boolean;
}

/** The seqs between two lines of `order`, both included, or null if either isn't in it. */
function run(order: readonly number[], from: number, to: number): number[] | null {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return null;
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function only(seq: number): LogSelection {
  return { selected: new Set([seq]), anchor: seq, active: seq };
}

/**
 * A click on a line. `order` is the shown lines' seqs in list order.
 */
export function clickSelection(
  sel: LogSelection,
  seq: number,
  order: readonly number[],
  keys: ClickKeys,
): LogSelection {
  if (keys.range && sel.anchor !== null) {
    const seqs = run(order, sel.anchor, seq);
    if (seqs) return { selected: new Set(seqs), anchor: sel.anchor, active: seq };
  }
  if (keys.toggle) {
    const next = new Set(Array.from(sel.selected));
    if (next.has(seq)) next.delete(seq);
    else next.add(seq);
    return { selected: next, anchor: seq, active: seq };
  }
  return only(seq);
}

/**
 * ↑ or ↓ in the list. With nothing active, ↓ takes the first line and ↑ the
 * last. Without Shift only the new line is selected; with Shift, the run from
 * the anchor to it.
 */
export function moveSelection(
  sel: LogSelection,
  order: readonly number[],
  step: 1 | -1,
  extend: boolean,
): LogSelection {
  if (!order.length) return sel;
  const at = sel.active === null ? -1 : order.indexOf(sel.active);
  const index =
    at < 0
      ? step === 1
        ? 0
        : order.length - 1
      : Math.max(0, Math.min(order.length - 1, at + step));
  const seq = order[index];
  if (!extend) return only(seq);
  const anchor =
    sel.anchor !== null && order.indexOf(sel.anchor) >= 0 ? sel.anchor : (sel.active ?? seq);
  const seqs = run(order, anchor, seq) ?? [seq];
  return { selected: new Set(seqs), anchor, active: seq };
}

/**
 * The selected lines among those shown, in list order, each as Export writes
 * it. A selected line the filter hides is not copied.
 */
export function selectedLines(
  shown: readonly (LogRecordLike & { seq: number; ts: number; pid: number })[],
  selected: ReadonlySet<number>,
): { text: string; count: number } {
  const lines: string[] = [];
  if (selected.size) {
    for (let i = 0; i < shown.length; i++) {
      if (selected.has(shown[i].seq)) lines.push(formatLine(shown[i]));
    }
  }
  return { text: lines.join('\n'), count: lines.length };
}
