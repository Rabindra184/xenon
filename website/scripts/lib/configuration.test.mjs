import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { kebab, renderConfiguration, SECTIONS } from './configuration.mjs';

const require = createRequire(import.meta.url);

// js-yaml and lodash are not dependencies of website/. Both are installed in a
// normal checkout (Docusaurus brings js-yaml, the plugin brings lodash), so a
// test that needs one uses it when it is there and says so when it is not.
const tryLoad = (load) => {
  try {
    return load();
  } catch {
    return null;
  }
};
const jsYaml = tryLoad(() => require('js-yaml'));
const lodash = tryLoad(() => require('../../../node_modules/lodash'));

const fixture = () =>
  JSON.parse(readFileSync(new URL('./fixtures/schema.json', import.meta.url), 'utf8'));

const rowFor = (output, option) =>
  output.split('\n').find((line) => line.startsWith(`| \`${option}\``));

test('sections come in order, and an unlisted option goes under Advanced', () => {
  const out = renderConfiguration(fixture());
  const session = out.indexOf('## Session Control');
  const advanced = out.indexOf('## Advanced');
  assert.ok(session > -1, 'has Session Control');
  assert.ok(advanced > session, 'Advanced comes after Session Control');
  assert.ok(out.indexOf('brandNewOption') > advanced, 'brandNewOption only after Advanced');
  assert.equal(out.indexOf('brandNewOption'), out.lastIndexOf('brandNewOption'));
});

test('SECTIONS names every group with a title and keys', () => {
  assert.ok(SECTIONS.length > 5);
  for (const s of SECTIONS) {
    assert.equal(typeof s.title, 'string');
    assert.ok(Array.isArray(s.keys) && s.keys.length > 0);
  }
  assert.equal(SECTIONS.find((s) => s.title === 'Session Control').keys[0], 'maxSessions');
});

test('a section with no options in the schema is left out', () => {
  const out = renderConfiguration(fixture());
  assert.ok(!out.includes('## Networking'));
});

test('maxSessions shows its flag, type, default and that it is required', () => {
  const row = rowFor(renderConfiguration(fixture()), 'maxSessions');
  assert.ok(row, 'row exists');
  assert.ok(row.includes('`--plugin-xenon-max-sessions`'));
  assert.ok(row.includes('integer'));
  assert.ok(row.includes('`8`'));
  assert.ok(row.includes('required'));
});

test('an enum lists its values', () => {
  const row = rowFor(renderConfiguration(fixture()), 'platform');
  assert.ok(row.includes('`ios`'));
  assert.ok(row.includes('`android`'));
  assert.ok(row.includes('`both`'));
  assert.ok(row.includes('`"both"`'), 'default is shown as JSON in code');
});

test('a missing default is an em dash', () => {
  const row = rowFor(renderConfiguration(fixture()), 'brandNewOption');
  assert.ok(row.includes('—'));
});

test('an object with a definition gets one row per field', () => {
  const out = renderConfiguration(fixture());
  assert.ok(rowFor(out, 'autowait'));
  assert.ok(rowFor(out, 'autowait.enabled'));
  assert.ok(rowFor(out, 'autowait.timeoutMs'));
  assert.ok(!out.includes('See AutowaitConfig interface'));
  assert.ok(rowFor(out, 'autowait.enabled').includes('`false`'));
});

test('a missing definition does not throw and the object row stays', () => {
  const schema = fixture();
  delete schema.definitions.AutowaitConfig;
  let out;
  assert.doesNotThrow(() => {
    out = renderConfiguration(schema);
  });
  assert.ok(rowFor(out, 'autowait'));
  assert.ok(!rowFor(out, 'autowait.enabled'));
});

test('an array of defined objects gets rows named key[].field', () => {
  const schema = fixture();
  schema.properties.simulators = {
    type: 'array',
    items: { $ref: '#/definitions/SimulatorConfig' },
    default: [],
    description: 'Simulators to expose.',
  };
  schema.definitions.SimulatorConfig = {
    type: 'object',
    properties: { name: { type: 'string' }, sdk: { type: 'string' } },
    required: ['name'],
  };
  const out = renderConfiguration(schema);
  assert.ok(rowFor(out, 'simulators').includes('`[]`'));
  assert.ok(rowFor(out, 'simulators').includes('array of'));
  assert.ok(rowFor(out, 'simulators[].name').includes('required'));
  assert.ok(rowFor(out, 'simulators[].sdk'));
});

// schema.json's `interceptor` names its fields in prose ("Fields: enabled,
// bufferSize, captureBodies.") and no longer says "See InterceptorConfig
// interface for details.": its rows come from the definition named after it.
const interceptorDefinition = () => ({
  type: 'object',
  properties: {
    enabled: { type: 'boolean', default: false, description: 'Capture traffic.' },
    bufferSize: { type: 'number', default: 1000 },
  },
});

test('an object with no "See ... interface" sentence gets rows from the definition named after it', () => {
  const schema = fixture();
  schema.properties.interceptor = {
    type: 'object',
    description: 'Network capture. Fields: enabled, bufferSize.',
  };
  schema.definitions.InterceptorConfig = interceptorDefinition();
  const out = renderConfiguration(schema);
  assert.ok(rowFor(out, 'interceptor'));
  assert.ok(rowFor(out, 'interceptor.enabled').includes('`false`'));
  assert.ok(rowFor(out, 'interceptor.bufferSize').includes('`1000`'));
});

test('an object gets rows from the definition its $ref names, and its type from there', () => {
  const schema = fixture();
  schema.properties.interceptor = { $ref: '#/definitions/Capture' };
  schema.definitions.Capture = interceptorDefinition();
  const out = renderConfiguration(schema);
  assert.ok(rowFor(out, 'interceptor').includes('| object |'));
  assert.ok(rowFor(out, 'interceptor.enabled'));
  assert.ok(rowFor(out, 'interceptor.bufferSize'));
});

test('an object gets rows from its own properties', () => {
  const schema = fixture();
  schema.properties.interceptor = { type: 'object', ...interceptorDefinition() };
  const out = renderConfiguration(schema);
  assert.ok(rowFor(out, 'interceptor.enabled'));
  assert.ok(rowFor(out, 'interceptor.bufferSize'));
});

test('an object whose definition has another name still gets rows from the one its description names', () => {
  const schema = fixture();
  schema.properties.proxy = {
    type: 'object',
    description: 'Proxy configuration object. See AxiosProxy interface for details.',
  };
  schema.definitions.AxiosProxy = {
    type: 'object',
    properties: { host: { type: 'string' }, port: { type: 'integer' } },
  };
  const out = renderConfiguration(schema);
  assert.ok(rowFor(out, 'proxy.host'));
  assert.ok(rowFor(out, 'proxy.port'));
  assert.ok(!out.includes('See AxiosProxy interface'));
});

test('an object with no definition of its own keeps just its row', () => {
  const schema = fixture();
  schema.properties.derivedDataPath = {
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Map of derived data paths.',
  };
  const out = renderConfiguration(schema);
  assert.ok(rowFor(out, 'derivedDataPath'));
  assert.ok(!out.includes('`derivedDataPath.'));
});

test('a oneOf type is joined with an escaped pipe', () => {
  const schema = fixture();
  schema.properties.autowait = {
    default: false,
    description: 'Either one.',
    oneOf: [{ type: 'boolean' }, { type: 'object' }],
  };
  const row = rowFor(renderConfiguration(schema), 'autowait');
  assert.ok(row.includes('boolean \\| object'));
});

test('a pipe inside a description is escaped', () => {
  const schema = fixture();
  schema.properties.maxSessions.description = 'Use a | b here.';
  const row = rowFor(renderConfiguration(schema), 'maxSessions');
  assert.ok(row.includes('a \\| b'));
  assert.ok(!row.includes('a | b'));
});

test('angle brackets outside code are escaped, inside code they stay', () => {
  const schema = fixture();
  schema.properties.maxSessions.description = 'Under <root>/x and `<kept>` as is.';
  const row = rowFor(renderConfiguration(schema), 'maxSessions');
  assert.ok(row.includes('&lt;root>/x'));
  assert.ok(row.includes('`<kept>`'));
});

test('front matter, banner and a link to the environment variables page', () => {
  const out = renderConfiguration(fixture());
  assert.ok(out.startsWith('---\n'));
  assert.ok(out.includes('title: Configuration'));
  assert.ok(
    out.includes('custom_edit_url: https://github.com/Rabindra184/xenon/blob/main/schema.json'),
  );
  assert.ok(out.includes('generated from `schema.json`'));
  assert.ok(out.includes('(./environment-variables.md)'));
  assert.ok(out.includes('--plugin-xenon-'));
});

test('the intro shows flags, with a runnable command, and links to the complete file', () => {
  const out = renderConfiguration(fixture());
  const intro = out.slice(0, out.indexOf('## A complete config file'));
  assert.ok(
    intro.includes(
      'appium server --use-plugins=xenon --plugin-xenon-platform=android --plugin-xenon-max-sessions=4',
    ),
  );
  assert.ok(intro.includes('(#a-complete-config-file)'));
  assert.ok(!intro.includes('```yaml'), 'the only YAML block is the complete one');
  // Appium gives a boolean option's flag no value (store_const true), so a
  // false can only come from a config file.
  assert.ok(intro.includes('A flag for a `boolean` option can only turn it on'));
  assert.ok(intro.includes('To set one to `false`, such as `enableSelfHealing`, use a config file.'));
  assert.ok(!intro.includes('# ...and every other option'));
});

// The YAML block under "A complete config file".
const completeSection = (out) => {
  const start = out.indexOf('## A complete config file');
  assert.ok(start > -1, 'has the section');
  const end = out.indexOf('\n## ', start + 1);
  return out.slice(start, end === -1 ? undefined : end);
};
const completeBlock = (out) => {
  const match = completeSection(out).match(/```yaml\n([\s\S]*?)```/);
  assert.ok(match, 'has a yaml block');
  return match[1];
};

test('the complete config file comes before the option tables, with one sentence ahead of the block', () => {
  const out = renderConfiguration(fixture());
  assert.ok(out.indexOf('## A complete config file') < out.indexOf('## Session Control'));
  const section = completeSection(out);
  const prose = section
    .slice(0, section.indexOf('```yaml'))
    .replace('## A complete config file', '')
    .trim();
  assert.ok(prose.includes('Appium refuses a config file that leaves out any'));
  assert.ok(prose.includes('`appium server --config xenon.yaml`'));
  assert.equal(prose.split(/\.\s/).length, 1, 'one sentence');
});

test('fixture: the block holds every required key at its default and no other key', () => {
  const block = completeBlock(renderConfiguration(fixture()));
  assert.ok(block.startsWith('server:\n  use-plugins: [xenon]\n  plugin:\n    xenon:\n'));
  assert.ok(block.includes('\n      maxSessions: 8\n'));
  for (const other of ['platform', 'autowait', 'brandNewOption']) {
    assert.ok(!block.includes(`${other}:`), `${other} is not required`);
  }
});

test('the block lists required keys in section order, with Advanced last', () => {
  const schema = fixture();
  schema.properties.zzUnlisted = { type: 'boolean', default: true };
  schema.properties.platform.default = 'android';
  schema.required = ['zzUnlisted', 'maxSessions', 'platform'];
  const block = completeBlock(renderConfiguration(schema));
  const at = (key) => block.indexOf(`      ${key}:`);
  assert.ok(at('platform') < at('maxSessions'), 'Platform & Discovery before Session Control');
  assert.ok(at('maxSessions') < at('zzUnlisted'), 'Advanced last');
});

test('the block writes YAML a parser reads back as the defaults', (t) => {
  if (!jsYaml) return t.skip('js-yaml is not installed');
  const schema = fixture();
  schema.properties = {
    platform: { type: 'string', default: 'both' },
    buildCleanupSchedule: { type: 'string', default: '0 0 * * *' },
    bindHostOrIp: { type: 'string', default: 'auto' },
    tlsRejectUnauthorized: { type: 'boolean', default: true },
    maxSessions: { type: 'number', default: 8 },
    healthCheckSchedule: { type: 'string', default: '' },
    aiModel: { type: 'string', default: 'yes' },
    aiBaseUrl: { type: 'string', default: 'http://localhost:11434' },
    adbRemote: { type: 'array', default: [] },
    proxy: { type: 'object', default: { host: 'a b' } },
    hub: { type: 'string', default: 'null' },
  };
  schema.required = Object.keys(schema.properties);
  const expected = Object.fromEntries(
    schema.required.map((key) => [key, schema.properties[key].default]),
  );
  const doc = jsYaml.load(completeBlock(renderConfiguration(schema)));
  assert.deepEqual(doc.server['use-plugins'], ['xenon']);
  assert.deepEqual(doc.server.plugin.xenon, expected);
});

test('real schema: the block has each required key once, at its JSON default', () => {
  const schema = realSchema();
  const required = schema.required ?? [];
  if (required.length === 0) return assertConfigFileSection(renderConfiguration(schema));
  const block = completeBlock(renderConfiguration(schema));
  const lines = block.split('\n');
  for (const key of required) {
    const hits = lines.filter((line) => line.startsWith(`      ${key}: `));
    assert.equal(hits.length, 1, `${key} appears once`);
    const value = hits[0].slice(`      ${key}: `.length);
    const dflt = schema.properties[key].default;
    const bareString = typeof dflt === 'string' && value === dflt;
    assert.ok(bareString || value === JSON.stringify(dflt), `${key}: ${value}`);
  }
  const keys = lines.filter((line) => /^ {6}\S/.test(line));
  assert.equal(keys.length, required.length, 'no other option in the block');
});

test('real schema: a YAML parser reads the block back as the required defaults', (t) => {
  if (!jsYaml) return t.skip('js-yaml is not installed');
  const schema = realSchema();
  const required = schema.required ?? [];
  if (required.length === 0) return assertConfigFileSection(renderConfiguration(schema));
  const doc = jsYaml.load(completeBlock(renderConfiguration(schema)));
  const expected = Object.fromEntries(
    required.map((key) => [key, schema.properties[key].default]),
  );
  assert.deepEqual(Object.keys(doc), ['server']);
  assert.deepEqual(doc.server['use-plugins'], ['xenon']);
  assert.deepEqual(doc.server.plugin.xenon, expected);
});

// The page for a schema with no top-level `required` list (PR #446 removes it,
// because Appium refused any config file that left a required option out).
const withoutRequired = {
  absent: (schema) => {
    delete schema.required;
    return schema;
  },
  empty: (schema) => {
    schema.required = [];
    return schema;
  },
};

// Everything before the first section heading.
const introOf = (out) => out.slice(0, out.indexOf('\n## '));

// The "## A config file" section and its YAML block.
const configFileSection = (out) => {
  const start = out.indexOf('## A config file');
  assert.ok(start > -1, 'has the A config file section');
  const end = out.indexOf('\n## ', start + 1);
  return out.slice(start, end === -1 ? undefined : end);
};
const configFileBlock = (out) => {
  const match = configFileSection(out).match(/```yaml\n([\s\S]*?)```/);
  assert.ok(match, 'has a yaml block');
  return match[1];
};

// Every top-level option row of the tables (a nested field's row has a "." or
// "[" in its name).
const topLevelRows = (out) =>
  out.split('\n').filter((line) => /^\| `[A-Za-z0-9_]+`/.test(line));

// What a page for a schema with no `required` list must look like.
function assertConfigFileSection(out) {
  const intro = introOf(out);
  assert.ok(!/required|refuse|must list/i.test(intro), 'the intro says nothing about required options');
  assert.ok(intro.includes('(#a-config-file)'), 'the intro links to the section');
  assert.ok(!intro.includes('(#a-complete-config-file)'));
  assert.ok(!out.includes('## A complete config file'));
  assert.ok(
    out.indexOf('## A config file') < out.indexOf('| Option | Flag |'),
    'the section comes before the first option table',
  );

  const section = configFileSection(out);
  const prose = section.slice(0, section.indexOf('```yaml'));
  assert.ok(prose.includes('needs only the options you change'));
  assert.ok(prose.includes('Appium fills in every other default'));
  assert.ok(prose.includes('`appium server --config xenon.yaml`'));
  assert.ok(!/required|refuse/i.test(section), 'the section says nothing about required options');

  assert.equal(
    configFileBlock(out),
    [
      'server:',
      '  use-plugins: [xenon]',
      '  plugin:',
      '    xenon:',
      '      platform: android',
      '      maxSessions: 4',
      '',
    ].join('\n'),
  );
  for (const line of topLevelRows(out)) {
    assert.ok(!line.includes('(required)'), `no required marker: ${line.slice(0, 40)}`);
  }
}

for (const [how, strip] of Object.entries(withoutRequired)) {
  test(`no required list (${how}): no required text, no marker, and a short config file instead`, () => {
    const out = renderConfiguration(strip(fixture()));
    assertConfigFileSection(out);
    assert.ok(!out.includes('(required)'), 'no marker anywhere in the fixture page');
    assert.ok(!/refuse/i.test(out), 'no sentence says Appium refuses a file');
    assert.ok(!out.includes('marked required'));
    assert.ok(
      out.indexOf('## A config file') < out.indexOf('## Session Control'),
      'the section comes before the option tables',
    );
  });

  test(`no required list (${how}): the intro still shows the flags and the command`, () => {
    const intro = introOf(renderConfiguration(strip(fixture())));
    assert.ok(
      intro.includes(
        'appium server --use-plugins=xenon --plugin-xenon-platform=android --plugin-xenon-max-sessions=4',
      ),
    );
    assert.ok(intro.includes('server.plugin.xenon.<key>'));
    assert.ok(intro.includes('(./environment-variables.md)'));
  });

  test(`no required list (${how}): the short config file is the only yaml block, with two options`, (t) => {
    const out = renderConfiguration(strip(fixture()));
    assert.equal(out.split('```yaml').length - 1, 1, 'one yaml block on the page');
    const block = configFileBlock(out);
    const xenon = block.slice(block.indexOf('    xenon:\n') + '    xenon:\n'.length);
    assert.deepEqual(
      xenon.split('\n').filter(Boolean),
      ['      platform: android', '      maxSessions: 4'],
      'nothing else under xenon:',
    );
    if (!jsYaml) return t.skip('js-yaml is not installed');
    assert.deepEqual(jsYaml.load(block), {
      server: { 'use-plugins': ['xenon'], plugin: { xenon: { platform: 'android', maxSessions: 4 } } },
    });
  });
}

test('no required list: a definition that lists its own required fields keeps those markers', () => {
  const schema = fixture();
  delete schema.required;
  schema.definitions.AutowaitConfig.required = ['timeoutMs'];
  const out = renderConfiguration(schema);
  assert.ok(rowFor(out, 'autowait.timeoutMs').includes('(required)'));
  assert.ok(!rowFor(out, 'autowait.enabled').includes('(required)'));
  assert.ok(!rowFor(out, 'maxSessions').includes('(required)'));
});

test('a required list that has options keeps the complete config file and the required intro', () => {
  const out = renderConfiguration(fixture());
  const intro = introOf(out);
  assert.ok(intro.includes('[a complete config file](#a-complete-config-file)'));
  assert.ok(intro.includes('Appium refuses a config file that leaves out an option marked required.'));
  assert.ok(!out.includes('## A config file'));
  assert.ok(rowFor(out, 'maxSessions').includes('(required)'));
});

test('real schema with its required list removed, as PR 446 leaves it: the short config file', () => {
  const schema = realSchema();
  delete schema.required;
  const out = renderConfiguration(schema);
  assertConfigFileSection(out);
  for (const key of Object.keys(schema.properties)) assert.ok(rowFor(out, key), `${key} has a row`);
});

test('kebab matches how Appium spells a flag', () => {
  assert.equal(kebab('maxSessions'), 'max-sessions');
  assert.equal(kebab('h264Source'), 'h-264-source');
  assert.equal(kebab('androidH264'), 'android-h-264');
  assert.equal(kebab('remoteMachineProxyIP'), 'remote-machine-proxy-ip');
  assert.equal(
    kebab('removeDevicesFromDatabaseBeforeRunningThePlugin'),
    'remove-devices-from-database-before-running-the-plugin',
  );
});

test('kebab agrees with lodash.kebabCase, which Appium uses, on every real option', (t) => {
  if (!lodash) return t.skip('lodash is not installed at the repo root');
  const keys = [
    ...Object.keys(realSchema().properties),
    'h264Source',
    'androidH264',
    'ios17Tunnel',
    'port2',
    'x2y',
    'maxHTTPSessions',
    'enableJSONLogging',
    'IPAddress',
  ];
  for (const key of keys) assert.equal(kebab(key), lodash.kebabCase(key), key);
});

// Guards against the real schema.json drifting away from what the page says.
const realSchema = () =>
  JSON.parse(readFileSync(new URL('../../../schema.json', import.meta.url), 'utf8'));

test('real schema: every required option has a default, as the intro says', () => {
  const schema = realSchema();
  for (const key of schema.required ?? []) {
    assert.ok('default' in schema.properties[key], `${key} has a default`);
  }
});

test('real schema: the page says what the schema says about required options', () => {
  const schema = realSchema();
  const out = renderConfiguration(schema);
  if ((schema.required ?? []).length > 0) {
    assert.ok(out.includes('## A complete config file'));
    assert.ok(!out.includes('## A config file'));
  } else {
    assertConfigFileSection(out);
    assert.ok(!out.includes('## A complete config file'));
  }
});

// The sample under "A config file" names platform and maxSessions, so both must
// still be options the schema has, and android a value platform accepts.
test('real schema: the options in the short config file are real', () => {
  const { properties } = realSchema();
  assert.ok(properties.platform.enum.includes('android'), 'platform accepts android');
  assert.ok(['integer', 'number'].includes(properties.maxSessions.type), 'maxSessions is a number');
});

test('real schema: every option gets a row and a flag', () => {
  const schema = realSchema();
  const out = renderConfiguration(schema);
  for (const key of Object.keys(schema.properties)) {
    const row = rowFor(out, key);
    assert.ok(row, `${key} has a row`);
    assert.ok(row.includes('`--plugin-xenon-'), `${key} has a flag`);
  }
  assert.ok(!out.includes('interface for details'));
});

// The page listed `interceptor` with no field rows once schema.json stopped
// naming InterceptorConfig in its description.
test('real schema: every object option with a definition gets a row per field', () => {
  const schema = realSchema();
  const out = renderConfiguration(schema);
  const definitions = schema.definitions ?? {};
  const pascal = (key) => `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  let checked = 0;
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.type !== 'object') continue;
    const def = definitions[`${pascal(key)}Config`];
    if (!def?.properties) continue;
    for (const field of Object.keys(def.properties)) {
      assert.ok(rowFor(out, `${key}.${field}`), `${key}.${field} has a row`);
    }
    checked += 1;
  }
  assert.ok(checked >= 3, 'autowait, interceptor and streaming at least');
  for (const field of ['enabled', 'bufferSize', 'captureBodies']) {
    assert.ok(rowFor(out, `interceptor.${field}`), `interceptor.${field} has a row`);
  }
});

test('real schema: proxy lists the AxiosProxy fields', () => {
  const schema = realSchema();
  if (!schema.properties.proxy || !schema.definitions?.AxiosProxy?.properties) return;
  const out = renderConfiguration(schema);
  for (const field of Object.keys(schema.definitions.AxiosProxy.properties)) {
    assert.ok(rowFor(out, `proxy.${field}`), `proxy.${field} has a row`);
  }
});
