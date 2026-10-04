const REPO = 'https://github.com/Rabindra184/xenon';
const NONE = '—';

// The order and titles of the groups below are a copy of SECTION_ORDER in
// mac-app/src/renderer/src/schemaForm.ts, so the docs and the launcher's
// settings form read the same. An option that no group lists goes under
// "Advanced", so a new schema.json entry always shows up.
export const SECTIONS = [
  {
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
      'skipChromeDownload',
    ],
  },
  { title: 'Networking', keys: ['bindHostOrIp', 'remoteMachineProxyIP', 'proxy'] },
  {
    title: 'Session Control',
    keys: [
      'maxSessions',
      'deviceAvailabilityTimeoutMs',
      'deviceAvailabilityQueryIntervalMs',
      'newCommandTimeoutSec',
      'sessionHeartbeatIntervalMs',
    ],
  },
  {
    title: 'Hub ↔ Node',
    keys: [
      'hub',
      'sendNodeDevicesToHubIntervalMs',
      'checkStaleDevicesIntervalMs',
      'checkBlockedDevicesIntervalMs',
      'tlsRejectUnauthorized',
    ],
  },
  { title: 'Dashboard & Auth', keys: ['enableDashboard', 'authDisabled'] },
  { title: 'Health & Lifecycle', keys: ['healthCheckIntervalMs', 'healthCheckSchedule'] },
  {
    title: 'Data Retention',
    keys: ['buildCleanupDays', 'buildCleanupMaxCount', 'buildCleanupSchedule', 'deleteBuildAssets'],
  },
  { title: 'Database', keys: ['databaseProvider', 'databaseUrl'] },
  {
    title: 'AI & Self-Healing',
    keys: [
      'enableSelfHealing',
      'aiProvider',
      'aiModel',
      'aiBaseUrl',
      'geminiApiKey',
      'openaiApiKey',
      'anthropicApiKey',
    ],
  },
  { title: 'Streaming & Recording', keys: ['maxConcurrentRecordings', 'recordingsAssetsPath'] },
  { title: 'Autowait', keys: ['autowait'] },
  { title: 'Network Interceptor', keys: ['interceptor'] },
  { title: 'Misc', keys: ['enableJsonLogging'] },
];

const ADVANCED = 'Advanced';

const FRONT_MATTER = [
  '---',
  'title: Configuration',
  'description: Every option the Xenon plugin accepts, with its flag, type and default.',
  `custom_edit_url: ${REPO}/blob/main/schema.json`,
  '---',
  '',
].join('\n');

const BANNER =
  '<!-- This page is generated from `schema.json` by `website/scripts/generate.mjs`. Edit that file, not this one. -->';

const INTRO = `Xenon takes its options from Appium's plugin settings. Put an option in an Appium config file under \`server.plugin.xenon.<key>\`:

\`\`\`yaml
server:
  use-plugins: [xenon]
  plugin:
    xenon:
      platform: android
      maxSessions: 4
      # ...and every other option marked required below
\`\`\`

Run it with \`appium server --config xenon.yaml\`. Every option can also be a command-line flag, \`--plugin-xenon-<kebab-case>\`: \`maxSessions\` becomes \`--plugin-xenon-max-sessions\`. Options that hold an object or a list of objects, such as \`simulators\`, are easier to set in a config file.

A config file has to list every option marked required: Appium refuses to start when one is missing. Each of them has a default, so copy the default from the table if you have no reason to change it. Flags have no such rule, and an option you leave out takes its default. Defaults are shown as JSON.

A row such as \`autowait.enabled\` is a field inside the \`autowait\` object. Set it in a config file; it has no flag of its own.

API keys and other secrets belong in environment variables, not in a config file. See [Environment variables](./environment-variables.md).`;

// "maxSessions" -> "max-sessions", "remoteMachineProxyIP" -> "remote-machine-proxy-ip".
// This is how Appium turns an option name into a flag.
const kebab = (key) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

const refName = (ref) =>
  typeof ref === 'string' && ref.startsWith('#/definitions/')
    ? ref.slice('#/definitions/'.length)
    : undefined;

// An inline code span that is safe to put in a table cell.
const code = (value) => {
  const text = String(value);
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
};

// Makes text safe for one table cell of a CommonMark page. A "|" would end the
// cell, and a bare "<name>" would be read as an HTML tag, so both are escaped.
// Inline code is left as written, except that "|" is still escaped there: a
// table cell needs it even inside a code span.
function cell(text) {
  const parts = String(text).replace(/\s*\n\s*/g, ' ').split('`');
  // An odd number of backticks leaves the last part unclosed: plain text.
  const closed = parts.length % 2 === 1 ? parts.length : parts.length - 1;
  return parts
    .map((part, i) => {
      const inCode = i % 2 === 1 && i < closed;
      const escaped = inCode ? part : part.replace(/</g, '&lt;');
      return escaped.replace(/\|/g, '\\|');
    })
    .join('`');
}

function typeOf(prop, definitions) {
  if (Array.isArray(prop.type)) {
    const types = prop.type.filter((t) => t !== 'null');
    return types.join(' | ');
  }
  if (prop.type === 'array') {
    const item = resolve(prop.items, definitions);
    const itemType = item ? typeOf(item, definitions) : '';
    return itemType ? `array of ${itemType}` : 'array';
  }
  if (prop.type) return prop.type;
  const branches = prop.oneOf ?? prop.anyOf;
  if (Array.isArray(branches)) {
    const types = branches.map((b) => typeOf(resolve(b, definitions) ?? b, definitions)).filter(Boolean);
    return [...new Set(types)].join(' | ');
  }
  if (Array.isArray(prop.enum)) return 'string';
  return '';
}

function resolve(prop, definitions) {
  if (!prop || typeof prop !== 'object') return undefined;
  const name = refName(prop.$ref);
  return name ? definitions[name] : prop;
}

// "See AutowaitConfig interface for details." points at a TypeScript interface
// the reader never sees. The fields it names get their own rows instead.
const INTERFACE_SENTENCE = /\s*See (\w+) interface for details\./;

function describe(prop) {
  let text = (prop.description ?? '').replace(INTERFACE_SENTENCE, '').trim();
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    if (text && !/[.!?]$/.test(text)) text += '.';
    const values = prop.enum.map((v) => code(v)).join(', ');
    text = `${text ? `${text} ` : ''}One of: ${values}.`;
  }
  return text;
}

function row({ option, flag, prop, required, definitions }) {
  const name = `${code(option)}${required ? ' (required)' : ''}`;
  const type = typeOf(prop, definitions) || NONE;
  const dflt = 'default' in prop ? code(JSON.stringify(prop.default)) : NONE;
  return `| ${[name, flag ? code(flag) : NONE, type, dflt, describe(prop)].map(cell).join(' | ')} |`;
}

// The definition an object or array option takes its fields from, if any.
function fieldsOf(key, prop, definitions) {
  const named = prop.description?.match(INTERFACE_SENTENCE)?.[1];
  if (prop.type === 'object' && named) {
    const def = definitions[named];
    return def?.properties ? { prefix: `${key}.`, def } : undefined;
  }
  if (prop.type === 'array') {
    const name = refName(prop.items?.$ref);
    const def = name ? definitions[name] : undefined;
    return def?.properties ? { prefix: `${key}[].`, def } : undefined;
  }
  return undefined;
}

function rowsFor(key, prop, required, definitions) {
  const rows = [
    row({ option: key, flag: `--plugin-xenon-${kebab(key)}`, prop, required, definitions }),
  ];
  const nested = fieldsOf(key, prop, definitions);
  if (nested) {
    const requiredFields = new Set(nested.def.required ?? []);
    for (const [field, fieldProp] of Object.entries(nested.def.properties)) {
      rows.push(
        row({
          option: `${nested.prefix}${field}`,
          flag: undefined,
          prop: fieldProp,
          required: requiredFields.has(field),
          definitions,
        }),
      );
    }
  }
  return rows;
}

export function renderConfiguration(schema) {
  const properties = schema.properties ?? {};
  const definitions = schema.definitions ?? {};
  const required = new Set(schema.required ?? []);

  const listed = new Set(SECTIONS.flatMap((s) => s.keys));
  const unlisted = Object.keys(properties).filter((key) => !listed.has(key));
  const groups = [
    ...SECTIONS.map((s) => ({ title: s.title, keys: s.keys.filter((key) => key in properties) })),
    { title: ADVANCED, keys: unlisted },
  ].filter((g) => g.keys.length > 0);

  const out = [FRONT_MATTER, BANNER, '', INTRO, ''];
  for (const group of groups) {
    out.push(`## ${group.title}`, '', '| Option | Flag | Type | Default | Description |', '| --- | --- | --- | --- | --- |');
    for (const key of group.keys) {
      out.push(...rowsFor(key, properties[key], required.has(key), definitions));
    }
    out.push('');
  }
  return out.join('\n');
}
