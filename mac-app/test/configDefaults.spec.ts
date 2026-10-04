import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_REQUIRED_PLUGIN_ARGS, requiredDefaults } from '../src/main/configDefaults';
import type { XenonSchema } from '../src/shared/types';

const rootSchema = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'schema.json'), 'utf8')
) as XenonSchema;

describe('requiredDefaults', () => {
  it("fills the schema's own required list when it has one", () => {
    const schema = {
      properties: { a: { default: 1 }, b: { default: 2 } },
      required: ['a']
    } as unknown as XenonSchema;
    expect(requiredDefaults(schema)).toEqual({ a: 1 });
  });

  it('still fills the args older plugins require when the schema has no required list', () => {
    // The launcher's snapshot comes from this repo, but the plugin it starts is
    // whatever is installed in APPIUM_HOME. A plugin before the list was dropped
    // refuses a config file without these, so the launcher keeps writing them.
    expect(rootSchema.required).toBeUndefined();
    const defaults = requiredDefaults(rootSchema);
    expect(Object.keys(defaults).sort()).toEqual([...LEGACY_REQUIRED_PLUGIN_ARGS].sort());
    expect(defaults.enableJsonLogging).toBe(false);
    expect(defaults.buildCleanupSchedule).toBe('0 0 * * *');
  });

  it('skips a listed arg the schema lacks or gives no default', () => {
    const schema = {
      properties: { platform: { default: 'both' }, maxSessions: {} }
    } as unknown as XenonSchema;
    expect(requiredDefaults(schema)).toEqual({ platform: 'both' });
  });
});
