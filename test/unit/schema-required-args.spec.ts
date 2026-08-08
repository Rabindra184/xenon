import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

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
// An arg with a default must be optional: the schema default and the code's own
// destructuring fallback already supply the value.

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schema.json'), 'utf8'),
) as { properties: Record<string, { default?: unknown }>; required: string[] };

/** Args already both required and defaulted when this guard was added. */
const KNOWN_REQUIRED_WITH_DEFAULT = 23;

describe('schema.json required args', () => {
  it('does not grow the set of args that are required despite having a default', () => {
    // A default means "you may omit this", which is the opposite of required.
    // 23 args already sit in both lists; they only work because the Mac app
    // writes every required key into the config it generates, so a hand-written
    // or older config is already fragile against them. That is pre-existing
    // debt, not something to fix in a hotfix — but the set must not GROW,
    // because each addition breaks every config written before it.
    const contradictory = schema.required.filter(
      (key) => schema.properties[key] && 'default' in schema.properties[key],
    );

    expect(
      contradictory.length,
      `New required-with-default arg(s): ${contradictory.slice(KNOWN_REQUIRED_WITH_DEFAULT).join(', ')}. ` +
        'An existing config that omits them fails Appium config validation and the server ' +
        'will not start. Give the arg a default and leave it out of `required`.',
    ).to.equal(KNOWN_REQUIRED_WITH_DEFAULT);
  });

  it('keeps every required arg present in properties', () => {
    const missing = schema.required.filter((key) => !schema.properties[key]);
    expect(missing, 'required lists an arg that does not exist').to.deep.equal([]);
  });

  it('does not require the recording retention args', () => {
    // Named explicitly: this is the regression that took a live server down.
    for (const key of [
      'recordingCleanupDays',
      'recordingCleanupMaxCount',
      'recordingFailedCleanupDays',
    ]) {
      expect(schema.properties[key], `${key} should exist`).to.be.an('object');
      expect(schema.required, `${key} must stay optional`).to.not.include(key);
    }
  });
});
