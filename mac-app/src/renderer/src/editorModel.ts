import type { FormField } from './schemaForm';

// Pure value-mapping helpers behind the chip and table editors. Kept out of the
// components so the round-trip logic is unit-testable.

export function addChip(list: string[], raw: string): string[] {
  const v = raw.trim();
  if (!v || list.includes(v)) return list;
  return [...list, v];
}

export function removeChip(list: string[], index: number): string[] {
  return list.filter((_, i) => i !== index);
}

/** Table rows → schema value. All-empty rows are dropped; nothing left = unset. */
export function rowsToValue(rows: Array<Record<string, string>>): Array<Record<string, string>> | undefined {
  const kept = rows.filter((r) => Object.values(r).some((v) => v.trim() !== ''));
  return kept.length ? kept : undefined;
}

/** Columns for a table-editable object-array field, or null to fall back to JSON. */
export function columnsFor(field: FormField): string[] | null {
  return field.itemColumns ?? null;
}
