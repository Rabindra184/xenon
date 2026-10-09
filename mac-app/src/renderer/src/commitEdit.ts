// Ending the edit in the box that has the cursor, before a start reads the
// draft. A JSON box and a table cell commit what they hold when they lose
// focus, and ⌘⏎ (a menu accelerator) moves no focus, so without this a start
// launches what the box held before the edit.

/** Boxes that keep text of their own until they lose focus, or that a blur ends an edit in. */
const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

/**
 * Commits the edit in the focused box, as leaving it would, and puts the
 * cursor back: blur, then focus again. True when a box had the cursor (its
 * edit may have changed the draft), false when nothing was being typed in.
 */
export function commitFocusedEdit(doc: Document = document): boolean {
  const el = doc.activeElement;
  if (!(el instanceof HTMLElement) || !el.matches(EDITABLE)) return false;
  el.blur();
  el.focus({ preventScroll: true });
  return true;
}
