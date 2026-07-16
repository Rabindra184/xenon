import { describe, expect, it } from 'vitest';
import { filterSections } from '../src/renderer/src/settingsFilter';
import type { FormSection } from '../src/renderer/src/schemaForm';

const sections: FormSection[] = [
  {
    id: 'a',
    title: 'Platform',
    fields: [
      { key: 'platform', label: 'Platform', kind: 'select', required: true },
      { key: 'iosDeviceType', label: 'iOS Device Type', kind: 'select', required: true }
    ]
  },
  { id: 'b', title: 'AI', fields: [{ key: 'aiProvider', label: 'AI Provider', kind: 'select', required: false }] }
];

describe('filterSections', () => {
  it('returns input unchanged for an empty query', () => {
    expect(filterSections(sections, '  ')).toBe(sections);
  });

  it('matches on label case-insensitively', () => {
    const out = filterSections(sections, 'ios device');
    expect(out).toHaveLength(1);
    expect(out[0].fields.map((f) => f.key)).toEqual(['iosDeviceType']);
  });

  it('matches on raw key name and drops empty sections', () => {
    const out = filterSections(sections, 'aiprov');
    expect(out.map((s) => s.id)).toEqual(['b']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterSections(sections, 'zzz-nope')).toEqual([]);
  });
});
