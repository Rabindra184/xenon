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
  const block = completeBlock(renderConfiguration(schema));
  const lines = block.split('\n');
  for (const key of schema.required) {
    const hits = lines.filter((line) => line.startsWith(`      ${key}: `));
    assert.equal(hits.length, 1, `${key} appears once`);
    const value = hits[0].slice(`      ${key}: `.length);
    const dflt = schema.properties[key].default;
    const bareString = typeof dflt === 'string' && value === dflt;
    assert.ok(bareString || value === JSON.stringify(dflt), `${key}: ${value}`);
  }
  const keys = lines.filter((line) => /^ {6}\S/.test(line));
  assert.equal(keys.length, schema.required.length, 'no other option in the block');
});

test('real schema: a YAML parser reads the block back as the required defaults', (t) => {
  if (!jsYaml) return t.skip('js-yaml is not installed');
  const schema = realSchema();
  const doc = jsYaml.load(completeBlock(renderConfiguration(schema)));
  const expected = Object.fromEntries(
    schema.required.map((key) => [key, schema.properties[key].default]),
  );
  assert.deepEqual(Object.keys(doc), ['server']);
  assert.deepEqual(doc.server['use-plugins'], ['xenon']);
  assert.deepEqual(doc.server.plugin.xenon, expected);
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
  for (const key of schema.required) {
    assert.ok('default' in schema.properties[key], `${key} has a default`);
  }
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
