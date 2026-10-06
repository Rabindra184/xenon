import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// SchemaService's default bundled folder comes from paths.ts, which imports electron.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { SchemaService } from '../src/main/SchemaService';
import { installedPluginDir } from '../src/main/installedPluginVersion';

const created: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

const BUNDLED = {
  type: 'object',
  properties: { maxSessions: { type: 'number', default: 5 }, sessionMetrics: { type: 'boolean', default: true } }
};
const INSTALLED = { type: 'object', properties: { maxSessions: { type: 'number', default: 2 } } };

/** A stand-in for the bundled resources folder (schema.json + schema-meta.json). */
function makeBundledDir(): string {
  const dir = tmp('xenon-resources-');
  writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(BUNDLED));
  writeFileSync(path.join(dir, 'schema-meta.json'), JSON.stringify({ pluginVersion: '2.17.0', syncedFrom: 'test' }));
  return dir;
}

/** An APPIUM_HOME with the plugin installed; pass `schema: null` for one that ships no readable list. */
function makeHome(version: string, schema: unknown | null): string {
  const home = tmp('xenon-home-');
  const dir = installedPluginDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version, appium: { schema: 'schema.json' } }));
  if (schema !== null) writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(schema));
  return home;
}

afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('SchemaService.effectiveSchema', () => {
  it('uses the installed plugin list and reports its version', () => {
    const service = new SchemaService(() => makeBundledDir());
    const { schema, info } = service.effectiveSchema(makeHome('2.9.4', INSTALLED));
    expect(schema).toEqual(INSTALLED);
    expect(info).toEqual({ source: 'installed', pluginVersion: '2.9.4', installedVersion: '2.9.4' });
  });

  it('falls back to the bundled list, keeping the installed version, when the plugin list is unreadable', () => {
    const service = new SchemaService(() => makeBundledDir());
    const { schema, info } = service.effectiveSchema(makeHome('2.9.4', null));
    expect(schema).toEqual(BUNDLED);
    expect(info).toEqual({ source: 'bundled', pluginVersion: '2.17.0', installedVersion: '2.9.4' });
  });

  it('falls back to the bundled list with no installed version when the plugin is not installed', () => {
    const service = new SchemaService(() => makeBundledDir());
    const { schema, info } = service.effectiveSchema(tmp('xenon-home-'));
    expect(schema).toEqual(BUNDLED);
    expect(info).toEqual({ source: 'bundled', pluginVersion: '2.17.0', installedVersion: null });
  });

  it('picks up a newly installed version of the same Appium folder', () => {
    const service = new SchemaService(() => makeBundledDir());
    const home = makeHome('2.9.4', INSTALLED);
    expect(service.effectiveSchema(home).info.pluginVersion).toBe('2.9.4');

    const newer = { type: 'object', properties: { maxSessions: { type: 'number', default: 9 } } };
    const dir = installedPluginDir(home);
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.17.0', appium: { schema: 'schema.json' } }));
    writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(newer));
    const second = service.effectiveSchema(home);
    expect(second.info.installedVersion).toBe('2.17.0');
    expect(second.schema).toEqual(newer);
  });

  it('does not keep the bundled list for an install whose own list could not be read', () => {
    // Same version both times, so only the source can tell the calls apart.
    const service = new SchemaService(() => makeBundledDir());
    const home = makeHome('2.9.4', null);
    expect(service.effectiveSchema(home).info.source).toBe('bundled');

    writeFileSync(path.join(installedPluginDir(home), 'schema.json'), JSON.stringify(INSTALLED));
    const second = service.effectiveSchema(home);
    expect(second.info).toEqual({ source: 'installed', pluginVersion: '2.9.4', installedVersion: '2.9.4' });
    expect(second.schema).toEqual(INSTALLED);
  });

  it('keeps separate lists for separate Appium folders', () => {
    const service = new SchemaService(() => makeBundledDir());
    const a = service.effectiveSchema(makeHome('2.9.4', INSTALLED));
    const b = service.effectiveSchema(tmp('xenon-home-'));
    expect(a.info.source).toBe('installed');
    expect(b.info.source).toBe('bundled');
  });

  it('reports an unknown bundled version when schema-meta.json is missing', () => {
    const dir = tmp('xenon-resources-');
    writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(BUNDLED));
    const service = new SchemaService(() => dir);
    expect(service.effectiveSchema(tmp('xenon-home-')).info.pluginVersion).toBe('unknown');
  });
});

describe('SchemaService.requiredDefaults', () => {
  it('derives launch defaults from the installed plugin list', () => {
    const service = new SchemaService(() => makeBundledDir());
    const installed = { ...INSTALLED, required: ['maxSessions'] };
    expect(service.requiredDefaults(makeHome('2.9.4', installed))).toEqual({ maxSessions: 2 });
  });

  it('derives launch defaults from the bundled list when nothing is installed', () => {
    const service = new SchemaService(() => makeBundledDir());
    // The bundled fixture has no `required`, so the legacy list applies; of that
    // list only maxSessions is declared here.
    expect(service.requiredDefaults(tmp('xenon-home-'))).toEqual({ maxSessions: 5 });
  });
});
