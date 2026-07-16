import type { FormSection } from './schemaForm';

/**
 * Filter settings by label OR raw schema key (power users search by key).
 * Sections left with no matching fields are dropped.
 */
export function filterSections(sections: FormSection[], query: string): FormSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((s) => ({
      ...s,
      fields: s.fields.filter((f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q))
    }))
    .filter((s) => s.fields.length > 0);
}
