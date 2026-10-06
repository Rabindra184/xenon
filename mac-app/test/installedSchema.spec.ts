import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readInstalledSchema } from '../src/main/installedSchema';
import { installedPluginDir } from '../src/main/installedPluginVersion';

const created: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

const SCHEMA = { type: 'object', properties: { maxSessions: { type: 'number', default: 5 } } };

/** Lay a plugin package out in `dir` (package.json, plus the schema file when given). */
function writePlugin(dir: string, pkg: Record<string, unknown> | null, schema?: { file: string; content: string }): void {
  mkdirSync(dir, { recursive: true });
  if (pkg) writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  if (schema) writeFileSync(path.join(dir, schema.file), schema.content);
}

/** An APPIUM_HOME whose plugin folder is a real directory. */
function makeHome(pkg: Record<string, unknown> | null, schema?: { file: string; content: string }): string {
  const home = tmp('xenon-home-');
  writePlugin(installedPluginDir(home), pkg, schema);
  return home;
}

afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('readInstalledSchema', () => {
  it('reads the schema and version of the installed plugin', () => {
    const home = makeHome(
      { name: 'x', version: '2.9.4', appium: { schema: 'schema.json' } },
      { file: 'schema.json', content: JSON.stringify(SCHEMA) }
    );
    expect(readInstalledSchema(home)).toEqual({ schema: SCHEMA, version: '2.9.4' });
  });

  it('accepts a schema path written with a leading ./', () => {
    const home = makeHome(
      { version: '2.9.4', appium: { schema: './schema.json' } },
      { file: 'schema.json', content: JSON.stringify(SCHEMA) }
    );
    expect(readInstalledSchema(home)?.schema).toEqual(SCHEMA);
  });

  it('takes the file location from appium.schema instead of assuming one', () => {
    const home = makeHome({ version: '3.0.0', appium: { schema: 'build/options.json' } });
    const dir = installedPluginDir(home);
    mkdirSync(path.join(dir, 'build'));
    writeFileSync(path.join(dir, 'build', 'options.json'), JSON.stringify(SCHEMA));
    expect(readInstalledSchema(home)).toEqual({ schema: SCHEMA, version: '3.0.0' });
  });

  it('follows a plugin folder that is a symlink to a source checkout', () => {
    const checkout = tmp('xenon-checkout-');
    writePlugin(
      checkout,
      { version: '2.18.0-dev', appium: { schema: './schema.json' } },
      { file: 'schema.json', content: JSON.stringify(SCHEMA) }
    );
    const home = tmp('xenon-home-');
    const link = installedPluginDir(home);
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(checkout, link, 'dir');
    expect(readInstalledSchema(home)).toEqual({ schema: SCHEMA, version: '2.18.0-dev' });
  });

  it('returns null for an empty APPIUM_HOME', () => {
    expect(readInstalledSchema('')).toBeNull();
  });

  it('returns null when there is no package.json', () => {
    expect(readInstalledSchema(makeHome(null))).toBeNull();
  });

  it('returns null when package.json does not name a schema', () => {
    const home = makeHome({ version: '2.9.4', appium: {} }, { file: 'schema.json', content: JSON.stringify(SCHEMA) });
    expect(readInstalledSchema(home)).toBeNull();
  });

  it('returns null when appium.schema is not a string', () => {
    const home = makeHome({ version: '2.9.4', appium: { schema: { properties: {} } } });
    expect(readInstalledSchema(home)).toBeNull();
  });

  it('returns null when the schema file is missing', () => {
    const home = makeHome({ version: '2.9.4', appium: { schema: 'schema.json' } });
    expect(readInstalledSchema(home)).toBeNull();
  });

  it('returns null when the schema file is not valid JSON', () => {
    const home = makeHome({ version: '2.9.4', appium: { schema: 'schema.json' } }, { file: 'schema.json', content: '{ nope' });
    expect(readInstalledSchema(home)).toBeNull();
  });

  it('returns null when properties is an array', () => {
    const home = makeHome(
      { version: '2.9.4', appium: { schema: 'schema.json' } },
      { file: 'schema.json', content: JSON.stringify({ properties: [] }) }
    );
    expect(readInstalledSchema(home)).toBeNull();
  });

  it('returns null when the schema has no properties', () => {
    const home = makeHome(
      { version: '2.9.4', appium: { schema: 'schema.json' } },
      { file: 'schema.json', content: JSON.stringify({ type: 'object' }) }
    );
    expect(readInstalledSchema(home)).toBeNull();
  });

  it('returns null when the package has no version', () => {
    const home = makeHome({ appium: { schema: 'schema.json' } }, { file: 'schema.json', content: JSON.stringify(SCHEMA) });
    expect(readInstalledSchema(home)).toBeNull();
  });
});
