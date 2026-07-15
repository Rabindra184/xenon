import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resourcesDir } from './paths';
import type { SchemaMeta, XenonSchema } from '@shared/types';

// Loads the bundled schema.json snapshot (synced from the repo root at build
// time). The renderer builds the entire settings form from this — so the form
// automatically tracks the plugin's real config surface.
export class SchemaService {
  private schema: XenonSchema | null = null;
  private meta: SchemaMeta | null = null;

  load(): { schema: XenonSchema; meta: SchemaMeta } {
    if (!this.schema) {
      const dir = resourcesDir();
      this.schema = JSON.parse(readFileSync(path.join(dir, 'schema.json'), 'utf8')) as XenonSchema;
      try {
        this.meta = JSON.parse(readFileSync(path.join(dir, 'schema-meta.json'), 'utf8')) as SchemaMeta;
      } catch {
        this.meta = { pluginVersion: 'unknown', syncedFrom: 'unknown' };
      }
    }
    return { schema: this.schema, meta: this.meta! };
  }

  /**
   * Defaults for every property Appium marks as `required`. Appium validates a
   * --config file against the full schema (including `required`), so the
   * generated launch config MUST carry all required keys or the server refuses
   * to start. Filling them from schema defaults also makes each launch config
   * complete and reproducible.
   */
  requiredDefaults(): Record<string, unknown> {
    const { schema } = this.load();
    const out: Record<string, unknown> = {};
    for (const key of schema.required ?? []) {
      const prop = schema.properties[key];
      if (prop && prop.default !== undefined) out[key] = prop.default;
    }
    return out;
  }
}
