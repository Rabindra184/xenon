import type { JsonSchemaProperty, XenonSchema } from '@shared/types';

// Turns schema.json into a sectioned, typed form model. The section grouping
// mirrors docs/server-args.md; anything not explicitly mapped lands in "Advanced".

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
  /** Secret-bearing settings are hidden from the form and handled in the Secrets panel. */
  secret?: boolean;
  /** For arrays of objects: the item property names, enabling a table editor. */
  itemColumns?: string[];
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
  { id: 'db', title: 'Database', keys: ['databaseProvider', 'databaseUrl'] },
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
const SECRET_KEYS = new Set(['geminiApiKey', 'openaiApiKey', 'anthropicApiKey']);

function typeOf(p: JsonSchemaProperty): string | undefined {
  return Array.isArray(p.type) ? p.type.find((t) => t !== 'null') : p.type;
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

// Proper nouns / initialisms that naive Title-Casing would mangle ("Ios", "Adb"…).
const PROPER_NOUNS: Record<string, string> = {
  ios: 'iOS',
  ip: 'IP',
  adb: 'ADB',
  ai: 'AI',
  api: 'API',
  url: 'URL',
  tls: 'TLS',
  json: 'JSON',
  db: 'DB',
  id: 'ID'
};

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word, i) => {
      const proper = PROPER_NOUNS[word.toLowerCase()];
      if (proper) return proper;
      if (word === 'Ms' && i > 0) return '(ms)';
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}

function fieldFromProperty(
  key: string,
  prop: JsonSchemaProperty,
  required: Set<string>,
  definitions: Record<string, JsonSchemaProperty>
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
    // Resolve known nested definitions (autowait, interceptor) into sub-fields.
    const defName = key.charAt(0).toUpperCase() + key.slice(1) + 'Config';
    const def = definitions[defName];
    if (def?.properties) {
      const children = Object.entries(def.properties).map(([ck, cp]) =>
        fieldFromProperty(ck, cp as JsonSchemaProperty, new Set(), definitions)
      );
      return { ...base, kind: 'nested', children };
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
      if (!prop) continue;
      claimed.add(key);
      fields.push(fieldFromProperty(key, prop, required, definitions));
    }
    if (fields.length) sections.push({ id: sec.id, title: sec.title, fields });
  }

  // Sweep any unmapped properties into Advanced so the form never silently drops config.
  const leftovers = Object.keys(schema.properties).filter((k) => !claimed.has(k));
  if (leftovers.length) {
    sections.push({
      id: 'advanced',
      title: 'Advanced',
      fields: leftovers.map((k) => fieldFromProperty(k, schema.properties[k], required, definitions))
    });
  }

  return sections;
}
