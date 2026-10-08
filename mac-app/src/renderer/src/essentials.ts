// The Essentials catalog: the everyday options Settings opens on, each in plain
// words and each mapped to what it changes: a Xenon option, a profile server
// field, or a Keychain secret. Pure, so the rules are unit-tested; the screen
// that draws the rows is Settings.
//
// A row reads from the profile and writes a new one, never changing the one it
// was given. Reading never writes: an option the profile leaves unset reads
// Xenon's own default (`ctx.defaults`), and stays unset in the profile until
// someone changes it.

import { DEFAULT_PORT } from '@shared/profileDefaults';
import type { Profile, SecretKey } from '@shared/types';
import { SETTINGS } from './copy/settings';
import type { NumberUnit } from './numberField';

const WORDS = SETTINGS.essentials;

export type EssentialGroup = (typeof WORDS.groups)[keyof typeof WORDS.groups];

export type EssentialControl =
  | { kind: 'segmented'; options: { value: string; label: string }[] }
  | { kind: 'switch' }
  | { kind: 'number'; unit: NumberUnit; min?: number; max?: number; step?: number; integer?: boolean; suffix?: string }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'secret'; secret: SecretKey };

export interface EssentialCtx {
  /** The effective schema's property defaults, by option name. */
  defaults: Record<string, unknown>;
  /** The hub switch was turned on and no address has been typed yet, so nothing is saved to say so. */
  hubOpen: boolean;
  /** Which Keychain secrets hold a value (`secrets.status`). */
  secretsSaved: Partial<Record<SecretKey, boolean>>;
}

export interface EssentialRow {
  id: string;
  group: EssentialGroup;
  label: string;
  help?: string;
  /** The Xenon option, `server.port`, or the Keychain secret this row is about; shown with technical details on. */
  optionKey: string;
  control: EssentialControl;
  /** The row appears only when this holds. Rows without it always appear. */
  when?(p: Profile, ctx: EssentialCtx): boolean;
  /**
   * What the control shows: a string for a segmented or text row, a boolean for
   * a switch, the stored number (milliseconds, not minutes) for a number row,
   * and `{ saved, used }` for a secret row.
   */
  read(p: Profile, ctx: EssentialCtx): unknown;
  /** The profile with `value` in place. A value the row can't take leaves the profile as it was. */
  write(p: Profile, value: unknown): Profile;
}

type Read = EssentialRow['read'];
type Write = EssentialRow['write'];
type RowId = keyof typeof WORDS.labels;
type Rule = (p: Profile, ctx: EssentialCtx) => boolean;
type NumberControl = Extract<EssentialControl, { kind: 'number' }>;

/** What a builder is told about a row; its label comes from copy by id, and the option defaults to the id. */
interface Fields {
  id: RowId;
  group: EssentialGroup;
  optionKey?: string;
  help?: string;
  when?: Rule;
}

const base = ({ id, group, optionKey, help, when }: Fields) => ({
  id,
  group,
  label: WORDS.labels[id],
  optionKey: optionKey ?? id,
  ...(help === undefined ? {} : { help }),
  ...(when === undefined ? {} : { when })
});

// ─── Reading and writing a profile ──────────────────────────────────────────

/** An option's value: the profile's own, or the default when it leaves the option unset (null counts as unset). */
const stored = (p: Profile, key: string, ctx: EssentialCtx): unknown => p.settings[key] ?? ctx.defaults[key];

const withSetting = (p: Profile, key: string, value: unknown): Profile => ({
  ...p,
  settings: { ...p.settings, [key]: value }
});

const withoutSetting = (p: Profile, key: string): Profile => {
  if (!(key in p.settings)) return p;
  const settings = { ...p.settings };
  delete settings[key];
  return { ...p, settings };
};

const withPort = (p: Profile, port: number): Profile => ({ ...p, server: { ...p.server, port } });

const refsOf = (p: Profile): SecretKey[] => (Array.isArray(p.secretRefs) ? p.secretRefs : []);

// ─── What the rules below ask of other rows ─────────────────────────────────

const platformOf: Read = (p, ctx) => stored(p, 'platform', ctx) ?? 'both';
const androidInUse: Rule = (p, ctx) => platformOf(p, ctx) !== 'ios';
const iphoneInUse: Rule = (p, ctx) => platformOf(p, ctx) !== 'android';
const emulatorsInUse: Rule = (p, ctx) =>
  androidInUse(p, ctx) && stored(p, 'androidDeviceType', ctx) !== 'real';
const simulatorsInUse: Rule = (p, ctx) =>
  iphoneInUse(p, ctx) && stored(p, 'iosDeviceType', ctx) !== 'real';

/** On when an address is saved, or the switch was opened and no address typed yet. */
const hubOn: Rule = (p, ctx) => {
  const hub = p.settings.hub;
  return (typeof hub === 'string' && hub !== '') || ctx.hubOpen;
};

const selfHealingOn: Rule = (p, ctx) => stored(p, 'enableSelfHealing', ctx) === true;

/** The AI service in use. Xenon uses Gemini when none is chosen. */
const providerOf: Read = (p, ctx) => stored(p, 'aiProvider', ctx) ?? 'gemini';
const providerIs =
  (provider: string): Rule =>
  (p, ctx) =>
    selfHealingOn(p, ctx) && providerOf(p, ctx) === provider;

// ─── Row builders ───────────────────────────────────────────────────────────

const segmented = (pairs: readonly (readonly [string, string])[]): EssentialControl => ({
  kind: 'segmented',
  options: pairs.map(([value, label]) => ({ value, label }))
});

/** A choice stored as text in a Xenon option. `fallback` is what an unset option reads when the defaults hold none. */
function choiceRow(fields: Fields, control: EssentialControl, fallback?: string): EssentialRow {
  const row = base(fields);
  return {
    ...row,
    control,
    read: (p, ctx) => stored(p, row.optionKey, ctx) ?? fallback,
    write: (p, value) => (typeof value === 'string' ? withSetting(p, row.optionKey, value) : p)
  };
}

function switchRow(fields: Fields): EssentialRow {
  const row = base(fields);
  return {
    ...row,
    control: { kind: 'switch' },
    read: (p, ctx) => stored(p, row.optionKey, ctx) === true,
    write: (p, value) => (typeof value === 'boolean' ? withSetting(p, row.optionKey, value) : p)
  };
}

/** A number: unset reads the default, and writing `undefined` deletes the option so it goes back to it. */
function numberRow(fields: Fields, control: NumberControl): EssentialRow {
  const row = base(fields);
  return {
    ...row,
    control,
    read: (p, ctx) => stored(p, row.optionKey, ctx),
    write: (p, value) => {
      if (value === undefined || value === null) return withoutSetting(p, row.optionKey);
      return typeof value === 'number' && Number.isFinite(value) ? withSetting(p, row.optionKey, value) : p;
    }
  };
}

/** Text. An emptied box deletes the option, so an empty string is never saved. */
function textRow(fields: Fields, placeholder: string): EssentialRow {
  const row = base(fields);
  const read: Read = (p, ctx) => {
    const value = stored(p, row.optionKey, ctx);
    return typeof value === 'string' ? value : '';
  };
  const write: Write = (p, value) => {
    if (typeof value !== 'string') return p;
    const text = value.trim();
    return text === '' ? withoutSetting(p, row.optionKey) : withSetting(p, row.optionKey, text);
  };
  return { ...row, control: { kind: 'text', placeholder }, read, write };
}

/**
 * A Keychain secret. The profile only says whether it uses the key (`secretRefs`);
 * the value never passes through here, since the screen saves it with `secrets.set`.
 */
function secretRow(fields: Omit<Fields, 'optionKey' | 'help'>, secret: SecretKey): EssentialRow {
  return {
    ...base({ ...fields, optionKey: secret }),
    control: { kind: 'secret', secret },
    read: (p, ctx) => ({ saved: ctx.secretsSaved[secret] === true, used: refsOf(p).includes(secret) }),
    write: (p, value) => {
      const refs = refsOf(p);
      const used = refs.includes(secret);
      if (value === true) return used ? p : { ...p, secretRefs: [...refs, secret] };
      if (value === false) return used ? { ...p, secretRefs: refs.filter((k) => k !== secret) } : p;
      return p;
    }
  };
}

// ─── The catalog ────────────────────────────────────────────────────────────

const G = WORDS.groups;
const C = WORDS.choices;

export const ESSENTIALS: readonly EssentialRow[] = [
  // Phones
  choiceRow(
    { id: 'platform', group: G.phones },
    segmented([
      ['android', C.platform.android],
      ['ios', C.platform.ios],
      ['both', C.platform.both]
    ]),
    'both'
  ),
  choiceRow(
    { id: 'androidDeviceType', group: G.phones, when: androidInUse },
    segmented([
      ['real', C.androidDeviceType.real],
      ['simulated', C.androidDeviceType.simulated],
      ['both', C.androidDeviceType.both]
    ])
  ),
  switchRow({ id: 'bootedEmulators', group: G.phones, when: emulatorsInUse }),
  choiceRow(
    { id: 'iosDeviceType', group: G.phones, when: iphoneInUse },
    segmented([
      ['real', C.iosDeviceType.real],
      ['simulated', C.iosDeviceType.simulated],
      ['both', C.iosDeviceType.both]
    ])
  ),
  switchRow({ id: 'bootedSimulators', group: G.phones, when: simulatorsInUse }),

  // Tests
  numberRow(
    { id: 'maxSessions', group: G.tests },
    { kind: 'number', unit: 'plain', integer: true, min: 1, max: 99 }
  ),
  {
    // The port is in the profile's server section, which always has one: an emptied box goes back to Appium's usual.
    ...base({ id: 'port', group: G.tests, optionKey: 'server.port' }),
    control: { kind: 'number', unit: 'plain', integer: true, min: 1, max: 65535 },
    read: (p) => p.server.port,
    write: (p, value) => {
      if (value === undefined || value === null) return withPort(p, DEFAULT_PORT);
      return typeof value === 'number' && Number.isFinite(value) ? withPort(p, value) : p;
    }
  },
  numberRow(
    { id: 'deviceAvailabilityTimeoutMs', group: G.tests },
    { kind: 'number', unit: 'minutes-from-ms', step: 0.5, suffix: WORDS.suffix.minutes }
  ),

  // Recording & history
  switchRow({ id: 'enableDashboard', group: G.history, help: WORDS.help.enableDashboard }),
  numberRow(
    { id: 'buildCleanupDays', group: G.history },
    { kind: 'number', unit: 'days', integer: true, min: 1, suffix: WORDS.suffix.days }
  ),

  // Sharing & sign-in
  {
    // The option is "sign-in is off", so the switch says the opposite of it.
    ...base({ id: 'signIn', group: G.sharing, optionKey: 'authDisabled' }),
    control: { kind: 'switch' },
    read: (p) => !(p.settings.authDisabled ?? false),
    write: (p, value) => {
      if (value === true) return withoutSetting(p, 'authDisabled');
      return value === false ? withSetting(p, 'authDisabled', true) : p;
    }
  },
  {
    // Turning it on saves nothing: an empty address is not a setting, so the screen remembers
    // the switch is open (`hubOpen`) until an address is typed. Turning it off clears the
    // address and keeps the keys, which stay saved and used.
    ...base({ id: 'hub', group: G.sharing }),
    control: { kind: 'switch' },
    read: (p, ctx) => hubOn(p, ctx),
    write: (p, value) => (value === false ? withoutSetting(p, 'hub') : p)
  },
  textRow({ id: 'hubAddress', group: G.sharing, optionKey: 'hub', when: hubOn }, WORDS.placeholders.hubAddress),
  secretRow({ id: 'hubAccessKey', group: G.sharing, when: hubOn }, 'XENON_HUB_ACCESS_KEY'),
  secretRow({ id: 'hubToken', group: G.sharing, when: hubOn }, 'XENON_HUB_TOKEN'),

  // AI help
  switchRow({ id: 'enableSelfHealing', group: G.ai }),
  choiceRow(
    { id: 'aiProvider', group: G.ai, when: selfHealingOn },
    segmented([
      ['gemini', C.aiProvider.gemini],
      ['openai', C.aiProvider.openai],
      ['anthropic', C.aiProvider.anthropic],
      ['ollama', C.aiProvider.ollama]
    ]),
    'gemini'
  ),
  secretRow({ id: 'geminiKey', group: G.ai, when: providerIs('gemini') }, 'XENON_GEMINI_API_KEY'),
  secretRow({ id: 'openaiKey', group: G.ai, when: providerIs('openai') }, 'XENON_OPENAI_API_KEY'),
  secretRow({ id: 'anthropicKey', group: G.ai, when: providerIs('anthropic') }, 'XENON_ANTHROPIC_API_KEY'),
  textRow({ id: 'aiBaseUrl', group: G.ai, when: providerIs('ollama') }, WORDS.placeholders.aiBaseUrl)
];

/** The rows that apply to this profile now, in the catalog's order. */
export function visibleRows(p: Profile, ctx: EssentialCtx): EssentialRow[] {
  return ESSENTIALS.filter((row) => row.when?.(p, ctx) ?? true);
}

/**
 * Whether Xenon's own description of an option says a value saved in the
 * dashboard replaces the one in this file ("A value saved on the dashboard's
 * Maintenance page replaces this one"). Those rows show "The dashboard can override this."
 */
export function dashboardCanOverride(description: string | undefined): boolean {
  const d = description ?? '';
  return /dashboard/i.test(d) && /replaces this one/i.test(d);
}
