import type { JsonSchemaProperty, XenonSchema } from '@shared/types';
import { SECRET_DESCRIPTORS, SECRET_SETTINGS, SECRET_SETTING_PARTS } from '@shared/secrets';
import { humanize } from '@shared/humanize';
import { RETIRED_SETTINGS } from '@shared/retiredSettings';

// Turns schema.json into a sectioned, typed form model. The section grouping
// is the one the site's Configuration page uses
// (https://xenon-6e6.pages.dev/docs/configuration; website/scripts/lib/configuration.mjs
// keeps a copy of SECTION_ORDER); anything not explicitly mapped lands in "Advanced".

export type FieldKind = 'toggle' | 'number' | 'text' | 'select' | 'stringList' | 'nested' | 'json';

export interface FormField {
  key: string;
  label: string;
  kind: FieldKind;
  description?: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  min?: number;
  max?: number;
  /** For nested objects (autowait, interceptor): the sub-fields. */
  children?: FormField[];
  /**
   * Secret-bearing settings, and secret parts of a setting such as the cloud
   * key, are never offered a box: the form points to Keys & accounts instead.
   * A box saves while someone types, which would store a key's first letters.
   * Any form built from this model keeps that rule.
   */
  secret?: boolean;
  /** For arrays of objects: the item property names, enabling a table editor. */
  itemColumns?: string[];
  /**
   * A nested option whose shape takes more than its parts (the proxy: Xenon's definition allows other
   * properties). With technical details on, a screen also offers it as JSON.
   */
  jsonView?: boolean;
}

export interface FormSection {
  id: string;
  title: string;
  fields: FormField[];
}

const SECTION_ORDER: Array<{ id: string; title: string; keys: string[] }> = [
  {
    id: 'platform',
    title: 'Platform & Discovery',
    keys: [
      'platform',
      'androidDeviceType',
      'iosDeviceType',
      'simulators',
      'emulators',
      'bootedSimulators',
      'bootedEmulators',
      'adbRemote',
      'removeDevicesFromDatabaseBeforeRunningThePlugin',
      'skipChromeDownload'
    ]
  },
  { id: 'network', title: 'Networking', keys: ['bindHostOrIp', 'remoteMachineProxyIP', 'proxy'] },
  {
    id: 'session',
    title: 'Session Control',
    keys: [
      'maxSessions',
      'deviceAvailabilityTimeoutMs',
      'deviceAvailabilityQueryIntervalMs',
      'newCommandTimeoutSec',
      'sessionHeartbeatIntervalMs'
    ]
  },
  {
    id: 'hub',
    title: 'Hub ↔ Node',
    keys: [
      'hub',
      'sendNodeDevicesToHubIntervalMs',
      'checkStaleDevicesIntervalMs',
      'checkBlockedDevicesIntervalMs',
      'tlsRejectUnauthorized'
    ]
  },
  { id: 'dashboard', title: 'Dashboard & Auth', keys: ['enableDashboard', 'authDisabled'] },
  { id: 'health', title: 'Health & Lifecycle', keys: ['healthCheckIntervalMs', 'healthCheckSchedule'] },
  {
    id: 'retention',
    title: 'Data Retention',
    keys: ['buildCleanupDays', 'buildCleanupMaxCount', 'buildCleanupSchedule', 'deleteBuildAssets']
  },
  { id: 'db', title: 'Database', keys: ['databaseUrl'] },
  {
    id: 'ai',
    title: 'AI & Self-Healing',
    keys: ['enableSelfHealing', 'aiProvider', 'aiModel', 'aiBaseUrl', 'geminiApiKey', 'openaiApiKey', 'anthropicApiKey']
  },
  { id: 'streaming', title: 'Streaming & Recording', keys: ['maxConcurrentRecordings', 'recordingsAssetsPath'] },
  { id: 'autowait', title: 'Autowait', keys: ['autowait'] },
  { id: 'interceptor', title: 'Network Interceptor', keys: ['interceptor'] },
  { id: 'misc', title: 'Misc', keys: ['enableJsonLogging'] }
];

// These plugin args carry secrets; the launcher injects them as env vars via the
// Secrets panel, so they are flagged (and skipped) in the settings form.
const SECRET_KEYS = new Set(Object.keys(SECRET_SETTINGS));

function typeOf(p: JsonSchemaProperty): string | undefined {
  return Array.isArray(p.type) ? p.type.find((t) => t !== 'null') : p.type;
}

/**
 * The definition of a nested option whose name isn't `<Key>Config`, by the option's dotted path: the
 * proxy's is Xenon's AxiosProxy.
 */
const DEFINITION_FOR: Readonly<Record<string, string>> = { proxy: 'AxiosProxy' };

/**
 * Parts a nested option has that Xenon's definition doesn't list, by the option's dotted path, each
 * after the part named by `after` (at the end without one):
 * - the proxy's sign-in, which AxiosProxy gives as a plain object: its user name, and its password,
 *   which is a secret part (SECRET_SETTING_PARTS) and so a pointer to Keys & accounts (R39, R54);
 * - the cloud user name (R56), which the launch passes as CLOUD_USERNAME and never writes to the config.
 */
const EXTRA_PARTS: Readonly<Record<string, { after?: string; parts: Record<string, JsonSchemaProperty> }>> = {
  'proxy.auth': { parts: { username: { type: 'string' }, password: { type: 'string' } } },
  cloud: { after: 'url', parts: { username: { type: 'string' } } }
};

/** A nested option's definition: the one DEFINITION_FOR names, else `<Key>Config`. */
function definitionOf(
  path: string,
  key: string,
  definitions: Record<string, JsonSchemaProperty>
): JsonSchemaProperty | undefined {
  const named = Object.prototype.hasOwnProperty.call(DEFINITION_FOR, path) ? definitions[DEFINITION_FOR[path]] : undefined;
  return named ?? definitions[key.charAt(0).toUpperCase() + key.slice(1) + 'Config'];
}

/** A nested option's parts: its definition's, with EXTRA_PARTS put in their place; undefined when it has none. */
function partsOf(path: string, def: JsonSchemaProperty | undefined): Array<[string, JsonSchemaProperty]> | undefined {
  const listed = Object.entries(def?.properties ?? {});
  const extra = Object.prototype.hasOwnProperty.call(EXTRA_PARTS, path) ? EXTRA_PARTS[path] : undefined;
  if (!extra) return listed.length > 0 ? listed : undefined;
  const added = Object.entries(extra.parts).filter(([k]) => !listed.some(([l]) => l === k));
  const at = extra.after === undefined ? -1 : listed.findIndex(([k]) => k === extra.after);
  return at === -1 ? [...listed, ...added] : [...listed.slice(0, at + 1), ...added, ...listed.slice(at + 1)];
}

/** Array item schemas are `$ref`s (SimulatorConfig, EmulatorConfig) — follow them. */
function resolveRef(
  p: JsonSchemaProperty | undefined,
  definitions: Record<string, JsonSchemaProperty>
): JsonSchemaProperty | undefined {
  const ref = (p as { $ref?: string } | undefined)?.$ref;
  if (ref?.startsWith('#/definitions/')) return definitions[ref.slice('#/definitions/'.length)];
  return p;
}

function fieldFromProperty(
  key: string,
  prop: JsonSchemaProperty,
  required: Set<string>,
  definitions: Record<string, JsonSchemaProperty>,
  /** The setting's dotted path: its key, or `cloud.apiKey` for a nested one. */
  path: string = key
): FormField {
  const base: FormField = {
    key,
    label: humanize(key),
    kind: 'text',
    description: prop.description,
    required: required.has(key),
    default: prop.default
  };

  if (SECRET_KEYS.has(key)) return { ...base, kind: 'text', secret: true };
  if (Object.prototype.hasOwnProperty.call(SECRET_SETTING_PARTS, path)) {
    const part = SECRET_SETTING_PARTS[path];
    // Named as Keys & accounts names its secret ("Cloud access key").
    const label = SECRET_DESCRIPTORS.find((d) => d.key === part)?.label ?? base.label;
    return { ...base, label, kind: 'text', required: false, secret: true };
  }
  if (prop.enum) return { ...base, kind: 'select', enum: prop.enum };

  // A oneOf union that includes a boolean branch (e.g. streaming.androidH264:
  // boolean | { source }) renders as a simple on/off toggle — the common case.
  // Without this it has no bare `type`, falls through to a text field, and a user
  // ends up storing the string "true"/"false" instead of a real boolean.
  if (Array.isArray(prop.oneOf) && prop.oneOf.some((b) => typeOf(b) === 'boolean')) {
    return { ...base, kind: 'toggle' };
  }

  const t = typeOf(prop);
  if (t === 'boolean') return { ...base, kind: 'toggle' };
  if (t === 'number' || t === 'integer') return { ...base, kind: 'number', min: prop.minimum, max: prop.maximum };
  if (t === 'string') return { ...base, kind: 'text' };

  if (t === 'array') {
    const items = resolveRef(prop.items as JsonSchemaProperty | undefined, definitions);
    if (items && typeOf(items) === 'string') return { ...base, kind: 'stringList' };
    // Arrays of objects get a table editor when their item shape is known,
    // otherwise the JSON editor.
    const cols = items?.properties ? Object.keys(items.properties) : undefined;
    return { ...base, kind: 'json', itemColumns: cols };
  }

  if (t === 'object') {
    // Resolve known nested definitions (autowait, interceptor, the proxy, the cloud) into sub-fields.
    const def = definitionOf(path, key, definitions);
    const parts = partsOf(path, def);
    if (parts) {
      const children = parts.map(([ck, cp]) => fieldFromProperty(ck, cp, new Set(), definitions, `${path}.${ck}`));
      // A definition that allows other properties can hold more than the parts show.
      const open = def !== undefined && def.additionalProperties !== false;
      return { ...base, kind: 'nested', children, ...(open ? { jsonView: true } : {}) };
    }
    return { ...base, kind: 'json' };
  }

  return base;
}

export type JsonDraftResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse a JSON-editor draft: empty = unset; invalid JSON returns the parse error. */
export function parseJsonDraft(raw: string): JsonDraftResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function buildForm(schema: XenonSchema): FormSection[] {
  const required = new Set(schema.required ?? []);
  const definitions = schema.definitions ?? {};
  const claimed = new Set<string>();
  const sections: FormSection[] = [];

  for (const sec of SECTION_ORDER) {
    const fields: FormField[] = [];
    for (const key of sec.keys) {
      const prop = schema.properties[key];
      if (!prop || RETIRED_SETTINGS.has(key)) continue;
      claimed.add(key);
      fields.push(fieldFromProperty(key, prop, required, definitions));
    }
    if (fields.length) sections.push({ id: sec.id, title: sec.title, fields });
  }

  // Sweep any unmapped properties into Advanced so the form never silently drops config.
  const leftovers = Object.keys(schema.properties).filter((k) => !claimed.has(k) && !RETIRED_SETTINGS.has(k));
  if (leftovers.length) {
    sections.push({
      id: 'advanced',
      title: 'Advanced',
      fields: leftovers.map((k) => fieldFromProperty(k, schema.properties[k], required, definitions))
    });
  }

  return sections;
}
