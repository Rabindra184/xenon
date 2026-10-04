import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schema.json'), 'utf8'),
) as { properties: Record<string, { default?: unknown }> };

/**
 * Appium fills every default schema.json declares, so a server started the
 * normal way runs on those. DefaultPluginArgs (the block in
 * scripts/generate-types-from-schema.js) is the copy the plugin merges under
 * its options, and used to say 86400000 ms for the health check while the
 * schema, and so the running server, said 300000. A second copy that can
 * disagree is how the Settings page came to show a third number.
 */
describe('DefaultPluginArgs', () => {
  it('agrees with every default schema.json declares', () => {
    const disagreements = Object.entries(schema.properties)
      .filter(([key, prop]) => 'default' in prop && key in DefaultPluginArgs)
      .filter(
        ([key, prop]) =>
          (DefaultPluginArgs as unknown as Record<string, unknown>)[key] !== undefined &&
          JSON.stringify((DefaultPluginArgs as unknown as Record<string, unknown>)[key]) !==
            JSON.stringify(prop.default),
      )
      .map(([key, prop]) => ({
        key,
        schema: prop.default,
        defaultPluginArgs: (DefaultPluginArgs as unknown as Record<string, unknown>)[key],
      }));
    expect(disagreements).to.deep.equal([]);
  });
});
