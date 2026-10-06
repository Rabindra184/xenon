import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resourcesDir } from './paths';
import { requiredDefaults } from './configDefaults';
import { readInstalledSchema } from './installedSchema';
import { readInstalledPluginVersion } from './installedPluginVersion';
import type { EffectiveSchemaInfo, SchemaMeta, XenonSchema } from '@shared/types';

// Loads the option list (schema.json) the settings form and the generated
// launch config are built from. Two sources: the Xenon installed in the
// profile's Appium folder (preferred, so the form tracks what will actually
// run) and the snapshot bundled with the app (synced from the repo root at
// build time), used when nothing readable is installed.
export class SchemaService {
  private schema: XenonSchema | null = null;
  private meta: SchemaMeta | null = null;
  private readonly effective = new Map<string, { schema: XenonSchema; info: EffectiveSchemaInfo }>();

  constructor(private readonly resourcesDirFn: () => string = resourcesDir) {}

  load(): { schema: XenonSchema; meta: SchemaMeta } {
    if (!this.schema) {
      const dir = this.resourcesDirFn();
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
   * The option list for the Xenon in `appiumHome`: its own when readable, else
   * the bundled one (with `installedVersion` set when something is installed
   * but its list couldn't be read). Cached per folder and installed version, so
   * installing or updating the plugin takes effect on the next call.
   */
  effectiveSchema(appiumHome: string): { schema: XenonSchema; info: EffectiveSchemaInfo } {
    const installedVersion = readInstalledPluginVersion(appiumHome);
    const key = `${appiumHome}|${installedVersion}`;
    const cached = this.effective.get(key);
    if (cached) return cached;

    const installed = readInstalledSchema(appiumHome);
    let result: { schema: XenonSchema; info: EffectiveSchemaInfo };
    if (installed) {
      result = {
        schema: installed.schema,
        info: { source: 'installed', pluginVersion: installed.version, installedVersion: installed.version }
      };
    } else {
      const { schema, meta } = this.load();
      result = { schema, info: { source: 'bundled', pluginVersion: meta.pluginVersion, installedVersion } };
    }
    this.effective.set(key, result);
    return result;
  }

  /** Defaults the generated launch config must carry; see configDefaults.ts. */
  requiredDefaults(appiumHome: string): Record<string, unknown> {
    return requiredDefaults(this.effectiveSchema(appiumHome).schema);
  }
}
