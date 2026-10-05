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

// Appium refuses a config file that leaves out an option the schema lists as
// required, so while the list has options the intro sends a reader to the
// complete file. Without the list, a file needs only the options it changes.
const CONFIG_FILE_LEAD = {
  required:
    'start from [a complete config file](#a-complete-config-file): Appium refuses a config file that leaves out an option marked required.',
  none: 'as in [the example below](#a-config-file), which lists only the options it changes.',
};

const introFor = (hasRequired) => `Xenon takes its options from Appium's plugin settings. The quick way is a flag, \`--plugin-xenon-<kebab-case>\`: \`maxSessions\` becomes \`--plugin-xenon-max-sessions\`.

\`\`\`bash
appium server --use-plugins=xenon --plugin-xenon-platform=android --plugin-xenon-max-sessions=4
\`\`\`

An option you leave out takes its default. For anything beyond a quick try, put the options in an Appium config file under \`server.plugin.xenon.<key>\`${
  hasRequired ? ' and ' + CONFIG_FILE_LEAD.required : ', ' + CONFIG_FILE_LEAD.none
} Options that hold an object or a list of objects, such as \`simulators\`, are easier to set in a config file. Defaults are shown as JSON.

A row such as \`autowait.enabled\` is a field inside the \`autowait\` object. Set it in a config file; it has no flag of its own.

A flag for a \`boolean\` option can only turn it on: \`--plugin-xenon-booted-simulators\` sets \`bootedSimulators\` to \`true\`, and Appium doesn't start with a value after it, such as \`--plugin-xenon-booted-simulators=false\`. To set one to \`false\`, such as \`enableSelfHealing\`, use a config file.

API keys and other secrets belong in environment variables, not in a config file. See [Environment variables](./environment-variables.md).`;

// "maxSessions" -> "max-sessions", "remoteMachineProxyIP" -> "remote-machine-proxy-ip",
// "h264Source" -> "h-264-source". This is how Appium turns an option name into a
// flag: it uses lodash's kebabCase, which also puts a break between letters and
// digits. A test compares the two over every option in schema.json.
export const kebab = (key) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([A-Za-z])(\d)/g, '$1-$2')
    .replace(/(\d)([A-Za-z])/g, '$1-$2')
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
  const target = resolve(prop, definitions);
  if (target && target !== prop) return typeOf(target, definitions);
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
// the reader never sees, so it is left out of the description. The object's
// fields get their own rows instead (see objectDefinition).
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

// Object options whose definition isn't named after them: `proxy` takes the
// shape of Axios's proxy, `AxiosProxy`. Its description names it too ("See
// AxiosProxy interface for details."), but a description is worded for the
// people who read it: #488 reworded it without the sentence, and the page lost
// the proxy's fields until #495 put the sentence back. This doesn't depend on
// the wording.
const DEFINITION_NAMES = { proxy: 'AxiosProxy' };

// The schema an object option takes its fields from, found in schema.json
// itself, first match wins:
// - its own `properties`;
// - the definition its `$ref` names;
// - the definition DEFINITION_NAMES gives it, else the one named after it,
//   `interceptor` -> `InterceptorConfig`, the rule the launcher's settings
//   form uses (mac-app schemaForm.ts);
// - the definition its description names ("See AutowaitConfig interface for
//   details.").
// A description that names none, as `interceptor`'s doesn't, still gets rows.
function objectDefinition(key, prop, definitions) {
  if (prop.properties) return prop;
  const target = resolve(prop, definitions);
  if (target !== prop) return target;
  if (prop.type !== 'object') return undefined;
  const byName =
    definitions[DEFINITION_NAMES[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}Config`];
  if (byName?.properties) return byName;
  const named = prop.description?.match(INTERFACE_SENTENCE)?.[1];
  return named ? definitions[named] : undefined;
}

// The fields an object or array option has rows for, if any.
function fieldsOf(key, prop, definitions) {
  if (prop.type === 'array') {
    const def = resolve(prop.items, definitions);
    return def?.properties ? { prefix: `${key}[].`, def } : undefined;
  }
  const def = objectDefinition(key, prop, definitions);
  return def?.properties ? { prefix: `${key}.`, def } : undefined;
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

// Names a YAML parser reads as something other than a string.
const YAML_NOT_A_STRING = /^(true|false|null|yes|no|on|off|y|n|~)$/i;

// One value as YAML. A plain word stays bare; any other string is quoted, so a
// cron schedule, an empty string or "yes" survives. Numbers, booleans, null and
// empty or filled lists and objects are written as JSON, which is valid YAML.
function yamlValue(value) {
  if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) && !YAML_NOT_A_STRING.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

// The config file for a schema with no required options: only what a reader
// changes, with the same two options as the flags in the intro.
const SHORT_CONFIG = [
  'server:',
  '  use-plugins: [xenon]',
  '  plugin:',
  '    xenon:',
  '      platform: android',
  '      maxSessions: 4',
].join('\n');

// A config file Appium accepts as printed. It refuses one that leaves out any
// option in the schema's `required` list, so this lists each of them at its
// default, in the order of the tables below.
function completeConfig(groups, properties, required) {
  const lines = ['server:', '  use-plugins: [xenon]', '  plugin:', '    xenon:'];
  for (const group of groups) {
    for (const key of group.keys.filter((k) => required.has(k))) {
      const prop = properties[key];
      lines.push(
        'default' in prop
          ? `      ${key}: ${yamlValue(prop.default)}`
          : `      # ${key}: no default in the schema, set a value`,
      );
    }
  }
  return lines.join('\n');
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

  const hasRequired = required.size > 0;
  const out = [
    FRONT_MATTER,
    BANNER,
    '',
    introFor(hasRequired),
    '',
    ...(hasRequired
      ? [
          '## A complete config file',
          '',
          'Appium refuses a config file that leaves out any option marked required, so start from this one, change what you need, and run it with `appium server --config xenon.yaml`.',
          '',
          '```yaml',
          completeConfig(groups, properties, required),
          '```',
        ]
      : [
          '## A config file',
          '',
          'A config file needs only the options you change, and Appium fills in every other default. Save this as `xenon.yaml` and run it with `appium server --config xenon.yaml`.',
          '',
          '```yaml',
          SHORT_CONFIG,
          '```',
        ]),
    '',
  ];
  for (const group of groups) {
    out.push(`## ${group.title}`, '', '| Option | Flag | Type | Default | Description |', '| --- | --- | --- | --- | --- |');
    for (const key of group.keys) {
      out.push(...rowsFor(key, properties[key], required.has(key), definitions));
    }
    out.push('');
  }
  return out.join('\n');
}
