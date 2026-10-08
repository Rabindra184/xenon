import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allSettingsSections, type AllSettingsSection } from '../src/renderer/src/allSettings';
import { CATALOG_GROUPS, OPTION_CATALOG, fallbackEntry } from '../src/renderer/src/optionCatalog';
import { buildForm, type FormField } from '../src/renderer/src/schemaForm';
import { RETIRED_SETTINGS } from '../src/shared/retiredSettings';
import type { XenonSchema } from '../src/shared/types';

const schema = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'resources', 'schema.json'), 'utf8')
) as XenonSchema;

const everything = { technical: false, query: '' };

const keysOf = (sections: AllSettingsSection[]): string[] => sections.flatMap((s) => s.fields.map((f) => f.rawKey));
const groupsOf = (sections: AllSettingsSection[]): string[] => sections.map((s) => s.group);
const fieldOf = (sections: AllSettingsSection[], key: string) => sections.flatMap((s) => s.fields).find((f) => f.rawKey === key);

/** The bundled schema with one more option the catalog has never heard of. */
const withNewThing: XenonSchema = {
  ...schema,
  properties: {
    ...schema.properties,
    newThing: { type: 'boolean', description: 'Does a new thing. It needs a restart.' }
  }
};

describe('allSettingsSections', () => {
  it('lists every option except the retired ones, in the catalog’s groups', () => {
    const sections = allSettingsSections(schema, everything);
    const expected = Object.keys(schema.properties).filter((k) => !RETIRED_SETTINGS.has(k));
    expect(keysOf(sections).sort()).toEqual(expected.sort());
    expect(keysOf(sections)).toHaveLength(51);
  });

  it('puts the groups in the catalog’s order and drops the ones with no option', () => {
    const sections = allSettingsSections(schema, everything);
    expect(groupsOf(sections)).toEqual([
      'Phones',
      'Tests',
      'Recording & history',
      'Sharing & sign-in',
      'AI help',
      'Phone health',
      'Network',
      'Storage & logs'
    ]);
    // More has no option in the bundled schema, so it is not a section.
    expect(groupsOf(sections)).not.toContain('More');
    expect(CATALOG_GROUPS.filter((g) => groupsOf(sections).includes(g))).toEqual(groupsOf(sections));
  });

  it('counts the fields in each group', () => {
    const counts = Object.fromEntries(allSettingsSections(schema, everything).map((s) => [s.group, s.fields.length]));
    expect(counts).toEqual({
      Phones: 10,
      Tests: 6,
      'Recording & history': 12,
      'Sharing & sign-in': 6,
      'AI help': 7,
      'Phone health': 4,
      Network: 4,
      'Storage & logs': 2
    });
  });

  it('lists a group’s options in the catalog’s order', () => {
    const sections = allSettingsSections(schema, everything);
    const history = sections.find((s) => s.group === 'Recording & history');
    expect(history?.fields.map((f) => f.rawKey)).toEqual([
      'enableDashboard',
      'buildCleanupDays',
      'buildCleanupMaxCount',
      'buildCleanupSchedule',
      'deleteBuildAssets',
      'recordingCleanupDays',
      'recordingCleanupMaxCount',
      'recordingFailedCleanupDays',
      'maxConcurrentRecordings',
      'recordingsAssetsPath',
      'sessionMetrics',
      'streaming'
    ]);
  });

  it('puts each field in the group of its catalog entry, with that entry attached', () => {
    for (const section of allSettingsSections(schema, everything)) {
      for (const f of section.fields) {
        expect(f.entry, f.rawKey).toBe(OPTION_CATALOG[f.rawKey]);
        expect(f.entry.group, f.rawKey).toBe(section.group);
      }
    }
  });

  it('keeps each field as buildForm made it, with the raw name beside it', () => {
    const built = new Map<string, FormField>(buildForm(schema).flatMap((s) => s.fields.map((f) => [f.key, f] as const)));
    for (const f of allSettingsSections(schema, everything).flatMap((s) => s.fields)) {
      const { entry: _entry, rawKey, overridable: _overridable, ...field } = f;
      expect(rawKey).toBe(f.key);
      expect(field, rawKey).toEqual(built.get(rawKey));
    }
  });

  it('is the same list with technical details on, when there is no query', () => {
    expect(allSettingsSections(schema, { technical: true, query: '' })).toEqual(allSettingsSections(schema, everything));
  });

  it('does not change the schema it was given', () => {
    const copy = JSON.parse(JSON.stringify(withNewThing)) as XenonSchema;
    allSettingsSections(withNewThing, { technical: true, query: 'new' });
    expect(withNewThing).toEqual(copy);
  });
});

describe('retired options', () => {
  it('never appear, whatever the query', () => {
    for (const key of RETIRED_SETTINGS) {
      expect(keysOf(allSettingsSections(schema, everything))).not.toContain(key);
      expect(keysOf(allSettingsSections(schema, { technical: true, query: key }))).not.toContain(key);
    }
    expect(keysOf(allSettingsSections(schema, { technical: true, query: 'databaseProvider' }))).toEqual([]);
  });

  it('keep the group they were in, minus them', () => {
    const storage = allSettingsSections(schema, everything).find((s) => s.group === 'Storage & logs');
    expect(storage?.fields.map((f) => f.rawKey)).toEqual(['databaseUrl', 'enableJsonLogging']);
  });
});

describe('an option the catalog doesn’t know', () => {
  it('lands in a More section, last, with the fallback entry', () => {
    const sections = allSettingsSections(withNewThing, everything);
    expect(groupsOf(sections).at(-1)).toBe('More');
    const more = sections.at(-1)!;
    expect(more.fields.map((f) => f.rawKey)).toEqual(['newThing']);
    expect(more.fields[0].entry).toEqual(fallbackEntry('newThing', 'Does a new thing. It needs a restart.'));
    expect(more.fields[0].entry).toEqual({ label: 'New thing', help: 'Does a new thing.', group: 'More' });
    expect(more.fields[0].kind).toBe('toggle');
  });

  it('keeps the known options where they were', () => {
    const sections = allSettingsSections(withNewThing, everything);
    expect(keysOf(sections).filter((k) => k !== 'newThing')).toEqual(keysOf(allSettingsSections(schema, everything)));
  });

  it('lists several in the order the form gives them', () => {
    const more: XenonSchema = {
      ...schema,
      properties: { ...schema.properties, zebraMode: { type: 'boolean' }, appleMode: { type: 'string' } }
    };
    const last = allSettingsSections(more, everything).at(-1)!;
    expect(last.group).toBe('More');
    expect(last.fields.map((f) => f.rawKey)).toEqual(['zebraMode', 'appleMode']);
  });

  it('takes a name that is also an Object method for an option of its own, not a catalog entry', () => {
    const odd: XenonSchema = { ...schema, properties: { ...schema.properties, toString: { type: 'string' } } };
    const last = allSettingsSections(odd, everything).at(-1)!;
    expect(last.group).toBe('More');
    expect(last.fields.map((f) => f.rawKey)).toEqual(['toString']);
    expect(last.fields[0].entry).toEqual({ label: 'To string', help: '', group: 'More' });
  });

  it('is not in a section of its own when the schema has no unknown option', () => {
    expect(groupsOf(allSettingsSections(schema, everything))).not.toContain('More');
  });
});

describe('an older Xenon', () => {
  it('lists only the options its schema has', () => {
    const { sessionMetrics: _a, streaming: _b, ...properties } = schema.properties;
    const older: XenonSchema = { ...schema, properties };
    const sections = allSettingsSections(older, everything);
    expect(keysOf(sections)).not.toContain('sessionMetrics');
    expect(keysOf(sections)).toHaveLength(49);
    expect(sections.find((s) => s.group === 'Recording & history')?.fields).toHaveLength(10);
  });

  it('drops a group when none of its options exist', () => {
    const properties = Object.fromEntries(
      Object.entries(schema.properties).filter(([k]) => !['healthCheckIntervalMs', 'healthCheckSchedule', 'checkBlockedDevicesIntervalMs', 'removeDevicesFromDatabaseBeforeRunningThePlugin'].includes(k))
    );
    expect(groupsOf(allSettingsSections({ ...schema, properties }, everything))).not.toContain('Phone health');
  });
});

describe('search', () => {
  it('finds by what the label says, without regard to case', () => {
    expect(keysOf(allSettingsSections(schema, { technical: false, query: 'sign in' }))).toContain('authDisabled');
    expect(keysOf(allSettingsSections(schema, { technical: false, query: 'SIGN IN' }))).toContain('authDisabled');
    expect(keysOf(allSettingsSections(schema, { technical: false, query: 'Ask People' }))).toEqual(['authDisabled']);
  });

  it('finds by what the help says', () => {
    // "reservations" is in one option's help, and in no label.
    const found = allSettingsSections(schema, { technical: false, query: 'reservations' }).flatMap((s) => s.fields);
    expect(found.map((f) => f.rawKey)).toEqual(['removeDevicesFromDatabaseBeforeRunningThePlugin']);
    expect(found[0].entry.label.toLowerCase()).not.toContain('reservations');
    expect(found[0].entry.help.toLowerCase()).toContain('reservations');
  });

  it('finds an option by its raw name only with technical details on', () => {
    expect(keysOf(allSettingsSections(schema, { technical: false, query: 'maxSessions' }))).toEqual([]);
    expect(keysOf(allSettingsSections(schema, { technical: true, query: 'maxSessions' }))).toEqual(['maxSessions']);
  });

  it('matches the raw name without regard to case, and as part of a name', () => {
    expect(keysOf(allSettingsSections(schema, { technical: true, query: 'MAXSESSIONS' }))).toEqual(['maxSessions']);
    expect(keysOf(allSettingsSections(schema, { technical: true, query: 'tlsreject' }))).toEqual(['tlsRejectUnauthorized']);
    expect(keysOf(allSettingsSections(schema, { technical: false, query: 'tlsreject' }))).toEqual([]);
  });

  it('still finds by label and help with technical details on', () => {
    expect(keysOf(allSettingsSections(schema, { technical: true, query: 'sign in' }))).toContain('authDisabled');
  });

  it('keeps only the groups that have a match', () => {
    const sections = allSettingsSections(schema, { technical: false, query: 'sign in' });
    expect(sections.length).toBeGreaterThanOrEqual(1);
    for (const s of sections) expect(s.fields.length).toBeGreaterThan(0);
    expect(groupsOf(sections)).toContain('Sharing & sign-in');
    expect(groupsOf(sections)).not.toContain('Storage & logs');
  });

  it('reads an empty or blank query as no query', () => {
    expect(allSettingsSections(schema, { technical: false, query: '   ' })).toEqual(allSettingsSections(schema, everything));
  });

  it('ignores spaces around the query and treats a run of spaces as one', () => {
    expect(keysOf(allSettingsSections(schema, { technical: false, query: '  sign   in ' }))).toContain('authDisabled');
  });

  it('finds Mac’s when someone types a straight apostrophe', () => {
    const typed = keysOf(allSettingsSections(schema, { technical: false, query: "mac's" }));
    const curly = keysOf(allSettingsSections(schema, { technical: false, query: 'mac’s' }));
    expect(curly.length).toBeGreaterThan(0);
    expect(typed).toEqual(curly);
  });

  it('returns nothing when nothing matches', () => {
    expect(allSettingsSections(schema, { technical: true, query: 'zzz-no-such-setting' })).toEqual([]);
  });

  it('searches a fallback entry by its label, and by its raw name with technical details on', () => {
    expect(keysOf(allSettingsSections(withNewThing, { technical: false, query: 'new thing' }))).toEqual(['newThing']);
    expect(keysOf(allSettingsSections(withNewThing, { technical: false, query: 'newThing' }))).toEqual([]);
    expect(keysOf(allSettingsSections(withNewThing, { technical: true, query: 'newThing' }))).toEqual(['newThing']);
  });
});

describe('overridable', () => {
  it('is true where Xenon says a value saved on the dashboard replaces this one', () => {
    expect(fieldOf(allSettingsSections(schema, everything), 'buildCleanupDays')?.overridable).toBe(true);
    expect(fieldOf(allSettingsSections(schema, everything), 'enableSelfHealing')?.overridable).toBe(true);
    expect(fieldOf(allSettingsSections(schema, everything), 'aiProvider')?.overridable).toBe(true);
  });

  it('is false for the others', () => {
    expect(fieldOf(allSettingsSections(schema, everything), 'maxSessions')?.overridable).toBe(false);
    expect(fieldOf(allSettingsSections(schema, everything), 'platform')?.overridable).toBe(false);
  });

  it('is false for an option with no description', () => {
    const f = fieldOf(allSettingsSections(withNewThing, everything), 'newThing');
    expect(f?.overridable).toBe(false);
  });
});

describe('secrets', () => {
  const sections = allSettingsSections(schema, everything);

  it('keeps the secret mark on the options that hold a secret, so a screen shows a pointer, not a box', () => {
    for (const key of ['geminiApiKey', 'openaiApiKey', 'anthropicApiKey', 'databaseUrl']) {
      expect(fieldOf(sections, key)?.secret, key).toBe(true);
    }
  });

  it('keeps the secret parts of the cloud and proxy options', () => {
    const cloud = fieldOf(sections, 'cloud');
    expect(cloud?.kind).toBe('nested');
    expect(cloud?.children?.find((c) => c.key === 'apiKey')?.secret).toBe(true);
    const proxy = fieldOf(sections, 'proxy');
    expect(proxy).toBeDefined();
  });

  it('marks no other option as a secret', () => {
    const marked = sections.flatMap((s) => s.fields).filter((f) => f.secret).map((f) => f.rawKey).sort();
    expect(marked).toEqual(['anthropicApiKey', 'databaseUrl', 'geminiApiKey', 'openaiApiKey']);
  });
});

describe('allSettings.ts', () => {
  it('holds none of the catalog’s words: they come from optionCatalog', () => {
    const source = readFileSync(resolve(__dirname, '..', 'src/renderer/src/allSettings.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const e of Object.values(OPTION_CATALOG)) {
      expect(source).not.toContain(e.label);
      expect(source).not.toContain(e.help);
    }
  });
});
