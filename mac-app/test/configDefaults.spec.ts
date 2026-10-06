import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiredDefaults } from '../src/main/configDefaults';
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

  it('writes no defaults when the schema has no required list, so the plugin picks its own', () => {
    // A plugin without a required list (2.13.2+) accepts a partial config, and
    // an unset enableJsonLogging lets XENON_JSON_LOGGING decide. Writing the
    // old 23 args would pin them (enableJsonLogging: false) and defeat that.
    const schema = {
      properties: { platform: { default: 'both' }, maxSessions: { default: 8 }, enableJsonLogging: {} }
    } as unknown as XenonSchema;
    expect(requiredDefaults(schema)).toEqual({});
  });

  it('writes nothing for this repo schema, enableJsonLogging included', () => {
    expect(rootSchema.required).toBeUndefined();
    expect(rootSchema.properties.enableJsonLogging.default).toBeUndefined();
    expect(requiredDefaults(rootSchema)).toEqual({});
  });

  it('still writes the args an older plugin lists as required, as before', () => {
    const schema = {
      properties: {
        platform: { default: 'both' },
        maxSessions: { default: 8 },
        sessionMetrics: { default: true },
        enableJsonLogging: {}
      },
      required: ['platform', 'maxSessions', 'enableJsonLogging']
    } as unknown as XenonSchema;
    // enableJsonLogging has no default in the list: the launcher writes what
    // older plugins defaulted to. sessionMetrics isn't required: not written.
    expect(requiredDefaults(schema)).toEqual({ platform: 'both', maxSessions: 8, enableJsonLogging: false });
  });

  it('skips a listed arg the schema lacks or gives no default', () => {
    const schema = {
      properties: { platform: { default: 'both' }, maxSessions: {} },
      required: ['platform', 'maxSessions', 'bindHostOrIp']
    } as unknown as XenonSchema;
    expect(requiredDefaults(schema)).toEqual({ platform: 'both' });
  });
});
