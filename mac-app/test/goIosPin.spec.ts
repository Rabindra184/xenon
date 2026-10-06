import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadGoIosPin } from '../src/main/goIosPin';

const created: string[] = [];

/** A fake installed plugin folder; `script` is the body of goIosVersion.js (omit for no file). */
function makePluginDir(script?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xenon-plugin-'));
  created.push(dir);
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }));
  if (script !== undefined) {
    const scripts = path.join(dir, 'lib', 'src', 'scripts');
    mkdirSync(scripts, { recursive: true });
    writeFileSync(path.join(scripts, 'goIosVersion.js'), script);
  }
  return dir;
}

afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('loadGoIosPin', () => {
  it('reads GO_IOS_VERSION from the installed plugin', () => {
    expect(loadGoIosPin(makePluginDir("exports.GO_IOS_VERSION = 'v1.2.1';"))).toBe('v1.2.1');
  });

  it('reads the new pin after the plugin is updated in place', () => {
    const dir = makePluginDir("exports.GO_IOS_VERSION = 'v1.2.1';");
    expect(loadGoIosPin(dir)).toBe('v1.2.1');
    writeFileSync(path.join(dir, 'lib', 'src', 'scripts', 'goIosVersion.js'), "exports.GO_IOS_VERSION = 'v1.3.0';");
    expect(loadGoIosPin(dir)).toBe('v1.3.0');
  });

  it('returns null when the plugin does not ship the version file', () => {
    expect(loadGoIosPin(makePluginDir())).toBeNull();
  });

  it('returns null when the plugin folder does not exist', () => {
    expect(loadGoIosPin(path.join(tmpdir(), 'xenon-no-such-plugin-dir'))).toBeNull();
  });

  it('returns null when the version file throws', () => {
    expect(loadGoIosPin(makePluginDir("throw new Error('boom');"))).toBeNull();
  });

  it('returns null when GO_IOS_VERSION is not a string', () => {
    expect(loadGoIosPin(makePluginDir('exports.GO_IOS_VERSION = 121;'))).toBeNull();
  });
});
