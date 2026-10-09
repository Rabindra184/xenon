// The choices a Segmented control shows, and what a click on the chosen one does.

/** One choice: a bare string is both the value and the words shown; otherwise the label is shown. */
export type SegmentedOption = string | { value: string; label: string };

export function segmentedItems(options: readonly SegmentedOption[]): { value: string; label: string }[] {
  return options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option));
}

/**
 * A radio group never un-selects. A click (or Space) on the chosen option
 * clears it only when the control is `clearable`: a schema enum, where nothing
 * chosen means the default. Elsewhere (a filter, an Essentials choice) it stays.
 */
export function clearsOnClick(option: string, value: string | undefined, clearable: boolean): boolean {
  return clearable && option === value;
}
