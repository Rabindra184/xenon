// How a field's control is described to a screen reader. FieldFrame gives the
// description and the error these ids; the control points at them.

export const descriptionIdFor = (fieldId: string): string => `${fieldId}-description`;
export const errorIdFor = (fieldId: string): string => `${fieldId}-error`;

/**
 * The control's aria-describedby: `before` (a unit after the box, say), then
 * the description, then the error. `undefined` when there is none of them.
 */
export function fieldDescribedBy(
  fieldId: string,
  { description, error }: { description?: string; error?: string },
  before?: string
): string | undefined {
  const ids = [before, description ? descriptionIdFor(fieldId) : null, error ? errorIdFor(fieldId) : null];
  return ids.filter(Boolean).join(' ') || undefined;
}
