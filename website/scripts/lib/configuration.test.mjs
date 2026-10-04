import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { renderConfiguration, SECTIONS } from './configuration.mjs';

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

test('the intro says a config file must list the required options', () => {
  const out = renderConfiguration(fixture());
  assert.ok(out.includes('Appium refuses to start when one is missing'));
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
