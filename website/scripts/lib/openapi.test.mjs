import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { VERSION_TOKEN, withVersion } from './openapi.mjs';

test('the token is the one the server-side export writes', () => {
  assert.equal(VERSION_TOKEN, '__XENON_VERSION__');
});

test('every token is replaced', () => {
  const text =
    '{"version":"__XENON_VERSION__","d":"version **__XENON_VERSION__**, again __XENON_VERSION__"}';
  const out = withVersion(text, '2.14.0');
  assert.equal(out, '{"version":"2.14.0","d":"version **2.14.0**, again 2.14.0"}');
  assert.ok(!out.includes('__XENON_VERSION__'));
});

test('nothing but the token changes', () => {
  const text = [
    '{',
    '  "example": { "pluginVersion": "2.12.0", "file": "checkout-2.4.1.apk" },',
    '  "version": "__XENON_VERSION__",',
    '  "other": "__XENON_VERSIO__ and XENON_VERSION and $& and $1"',
    '}',
  ].join('\n');
  const out = withVersion(text, '2.14.0');
  assert.equal(out, text.split('__XENON_VERSION__').join('2.14.0'));
  assert.ok(out.includes('"pluginVersion": "2.12.0"'));
  assert.ok(out.includes('$& and $1'));
});

test('text without a token comes back as it was', () => {
  assert.equal(withVersion('{"a":1}\n', '2.14.0'), '{"a":1}\n');
});

test('the committed document becomes valid JSON carrying the given version', () => {
  const committed = readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8');
  assert.ok(committed.includes('__XENON_VERSION__'), 'website/openapi.json should carry the token');
  const spec = JSON.parse(withVersion(committed, '9.8.7'));
  assert.equal(spec.info.version, '9.8.7');
  assert.ok(spec.info.description.includes('version **9.8.7**'));
  assert.ok(Object.keys(spec.paths).length >= 100);
});

test('an empty version is refused', () => {
  assert.throws(() => withVersion('__XENON_VERSION__', ''), /version/);
  assert.throws(() => withVersion('__XENON_VERSION__', undefined), /version/);
});
