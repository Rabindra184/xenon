import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires -- a plain Node script's list
const { ALWAYS_PRESENT_PLUGIN_ARGS } = require('../../scripts/lib/always-present-plugin-args');

// Adding a plugin arg to schema.json's `required` list is a BREAKING change for
// every existing config file. Appium validates the config against this schema
// and refuses to start when a required key is absent:
//
//   Fatal Error: Errors in config file .../<id>.yaml:
//    REQUIRED must have required property 'recordingFailedCleanupDays'
//   Process exited (code=2)
//
// That is exactly what shipping the recording-retention args as `required` did
// in 1.12.0 — an already-running server would not come back up after upgrading,
// with no way to tell from the message that the fix is to edit a YAML file.
//
// An arg with a default must be optional: Appium fills in schema defaults after
// it validates the file, and the plugin merges DefaultPluginArgs as well. Until
// 2.13.1, 23 args were both required and defaulted, so a config file had to list
// all of them; even the README's five-option sample was refused. None is now.

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schema.json'), 'utf8'),
) as { properties: Record<string, { default?: unknown }>; required?: string[] };

const required = schema.required ?? [];

describe('schema.json required args', () => {
  it('requires no arg that has a default', () => {
    // A default means "you may omit this", which is the opposite of required.
    const contradictory = required.filter(
      (key) => schema.properties[key] && 'default' in schema.properties[key],
    );

    expect(
      contradictory,
      'An existing config that omits these fails Appium config validation and the server ' +
        'will not start. Give the arg a default and leave it out of `required`.',
    ).to.deep.equal([]);
  });

  it('keeps every required arg present in properties', () => {
    const missing = required.filter((key) => !schema.properties[key]);
    expect(missing, 'required lists an arg that does not exist').to.deep.equal([]);
  });

  it('types as always present only args that have a default', () => {
    // IPluginArgs keeps these fields non-optional (scripts/generate-types-from-schema.js
    // marks them required for type generation only). That is true only while each
    // exists and has a default for Appium and DefaultPluginArgs to fill in.
    const wrong = (ALWAYS_PRESENT_PLUGIN_ARGS as string[]).filter(
      (key) => !schema.properties[key] || !('default' in schema.properties[key]),
    );
    expect(wrong, 'listed as always present but missing or without a default').to.deep.equal([]);
  });

  it('does not require the recording retention args', () => {
    // Named explicitly: this is the regression that took a live server down.
    for (const key of [
      'recordingCleanupDays',
      'recordingCleanupMaxCount',
      'recordingFailedCleanupDays',
    ]) {
      expect(schema.properties[key], `${key} should exist`).to.be.an('object');
      expect(required, `${key} must stay optional`).to.not.include(key);
    }
  });
});
