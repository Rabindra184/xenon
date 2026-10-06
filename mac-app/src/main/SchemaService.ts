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
   * but its list couldn't be read). An installed list is cached per folder and
   * installed version, so installing or updating the plugin takes effect on the
   * next call. The bundled fallback is not cached: an unreadable install that
   * is repaired at the same version has to be picked up, and it costs a couple
   * of small file reads.
   */
  effectiveSchema(appiumHome: string): { schema: XenonSchema; info: EffectiveSchemaInfo } {
    const installedVersion = readInstalledPluginVersion(appiumHome);
    const key = `${appiumHome}|${installedVersion}`;
    const cached = this.effective.get(key);
    if (cached) return cached;

    const installed = readInstalledSchema(appiumHome);
    if (installed) {
      const result: { schema: XenonSchema; info: EffectiveSchemaInfo } = {
        schema: installed.schema,
        info: { source: 'installed', pluginVersion: installed.version, installedVersion: installed.version }
      };
      this.effective.set(key, result);
      return result;
    }
    const { schema, meta } = this.load();
    return { schema, info: { source: 'bundled', pluginVersion: meta.pluginVersion, installedVersion } };
  }

  /** Defaults the generated launch config must carry; see configDefaults.ts. */
  requiredDefaults(appiumHome: string): Record<string, unknown> {
    return requiredDefaults(this.effectiveSchema(appiumHome).schema);
  }
}
