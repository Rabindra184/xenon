// The model behind Settings' "All settings" tab: every option the installed
// Xenon has, in the catalog's plain words, grouped for testers and searchable.
// Pure, so the grouping and the search are unit-tested; the screen that draws
// the fields is Settings (Task 17).
//
// Each field is the form model's own (schemaForm.ts), unchanged, with the
// catalog's words beside it. `label` and `description` there are Xenon's
// technical ones, for technical details; a screen shows `entry.label` and
// `entry.help`. A field marked `secret` stays marked (it, and a secret part
// inside it, never get a box: the screen points to Keys & accounts).

import type { XenonSchema } from '@shared/types';
import { RETIRED_SETTINGS } from '@shared/retiredSettings';
import { dashboardCanOverride } from './essentials';
import {
  CATALOG_GROUPS,
  OPTION_CATALOG,
  fallbackEntry,
  type CatalogEntry,
  type CatalogGroup
} from './optionCatalog';
import { buildForm, type FormField } from './schemaForm';

export interface AllSettingsField extends FormField {
  /** The plain label and help the screen shows, and the group the field is in. */
  entry: CatalogEntry;
  /** The option's name in Xenon, shown with technical details on. */
  rawKey: string;
  /** Xenon says a value saved on the dashboard replaces this one ("The dashboard can override this."). */
  overridable: boolean;
  /**
   * The entry's label says the opposite of the option: "Ask people to sign in" sits on the raw
   * `authDisabled` toggle. The screen shows its switch inverted (on when the option is off or unset;
   * turning it off saves `true`), as the Essentials `signIn` row does.
   */
  inverted: boolean;
  /**
   * The catalog has no words for this option (a newer Xenon's): `entry` is the fallback, whose help is
   * the first sentence of Xenon's own description and may name options, variables or paths. A screen
   * shows that help only with technical details on.
   */
  fallback: boolean;
}

export interface AllSettingsSection {
  group: CatalogGroup;
  fields: AllSettingsField[];
}

/** Options whose catalog label says the opposite of the option itself. */
const INVERTED: ReadonlySet<string> = new Set(['authDisabled']);

/**
 * Options only technical details list. The database file's help points to Keys & accounts' "Database
 * file" row, and that row is shown with technical details on only, so without them the pointer would
 * lead nowhere.
 */
const TECHNICAL_ONLY: ReadonlySet<string> = new Set(['databaseUrl']);

/** Whether the catalog has its own entry for an option, never one inherited from Object (a schema could name an option "constructor"). */
const known = (key: string): boolean => Object.prototype.hasOwnProperty.call(OPTION_CATALOG, key);

function entryFor(field: FormField): CatalogEntry {
  return known(field.key) ? OPTION_CATALOG[field.key] : fallbackEntry(field.key, field.description);
}

/** Lower case, one kind of apostrophe and single spaces, so "Mac's" finds "Mac’s". */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * The options of this Xenon's schema in groups. Retired options are left out, and so are the
 * technical-only ones (the database file) unless `technical` is on. Within
 * a group they follow the catalog's order; an option the catalog doesn't know goes
 * in More, after the rest, in the order the form gives it. A group with no option is
 * left out.
 *
 * The query is matched without regard to case against each option's label and help,
 * and against its raw name too when `technical` is on. An empty query lists everything.
 */
export function allSettingsSections(
  schema: XenonSchema,
  opts: { technical: boolean; query: string }
): AllSettingsSection[] {
  const query = normalize(opts.query);
  const order = new Map(Object.keys(OPTION_CATALOG).map((key, index) => [key, index]));

  const fields: AllSettingsField[] = buildForm(schema)
    .flatMap((section) => section.fields)
    .filter((field) => !RETIRED_SETTINGS.has(field.key))
    .filter((field) => opts.technical || !TECHNICAL_ONLY.has(field.key))
    .map((field) => ({
      ...field,
      entry: entryFor(field),
      rawKey: field.key,
      overridable: dashboardCanOverride(field.description),
      inverted: INVERTED.has(field.key),
      fallback: !known(field.key)
    }))
    .filter(
      (field) =>
        query === '' ||
        normalize(field.entry.label).includes(query) ||
        normalize(field.entry.help).includes(query) ||
        (opts.technical && normalize(field.rawKey).includes(query))
    );

  // Array.sort is stable, so options with no catalog place (all in More) keep the form's order.
  const rank = (field: AllSettingsField): number => order.get(field.rawKey) ?? order.size;
  fields.sort((a, b) => rank(a) - rank(b));

  return CATALOG_GROUPS.map((group) => ({ group, fields: fields.filter((f) => f.entry.group === group) })).filter(
    (section) => section.fields.length > 0
  );
}
