import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadGoIosPin } from '../src/main/goIosPin';

const created: string[] = [];

/** What tsc emits for the plugin's goIosVersion.ts: hoisted `void 0` preamble, then the real assignment. */
const COMPILED = [
  '"use strict";',
  'Object.defineProperty(exports, "__esModule", { value: true });',
  'exports.GO_IOS_VERSION_FILE = exports.GO_IOS_VERSION = void 0;',
  'exports.goIOSDownloadUrl = goIOSDownloadUrl;',
  'exports.needsGoIOSInstall = needsGoIOSInstall;',
  "/** The go-ios release Xenon installs. Do not lower below v1.2.1. */",
  "exports.GO_IOS_VERSION = 'v1.2.1';",
  '/** File recording which version currently sits in the cache directory. */',
  "exports.GO_IOS_VERSION_FILE = '.go-ios-version';",
  'function goIOSDownloadUrl(platform, version = exports.GO_IOS_VERSION) {',
  '    return `https://example.invalid/${version}/go-ios-${platform}.zip`;',
  '}',
  ''
].join('\n');

/** A fake installed plugin folder; `script` is the body of goIosVersion.js (omit for no file). */
function makePluginDir(script?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xenon-plugin-'));
  created.push(dir);
  if (script !== undefined) writeScript(dir, script);
  return dir;
}

function writeScript(dir: string, script: string): void {
  const scripts = path.join(dir, 'lib', 'src', 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(path.join(scripts, 'goIosVersion.js'), script);
}

afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
  delete (globalThis as { __pinExecuted?: boolean }).__pinExecuted;
});

describe('loadGoIosPin', () => {
  it('reads GO_IOS_VERSION from the compiled plugin script', () => {
    expect(loadGoIosPin(makePluginDir(COMPILED))).toBe('v1.2.1');
  });

  it('accepts double quotes and loose whitespace', () => {
    expect(loadGoIosPin(makePluginDir('exports.GO_IOS_VERSION="v1.3.0";'))).toBe('v1.3.0');
    expect(loadGoIosPin(makePluginDir('exports.GO_IOS_VERSION  =  "v1.4.2" ;'))).toBe('v1.4.2');
  });

  it('ignores a comment that mentions an older pin before the real assignment', () => {
    const script = COMPILED.replace(
      '/** The go-ios release',
      "// GO_IOS_VERSION = 'v1.0.134' broke WDA\n/** The go-ios release"
    );
    expect(script).toContain("// GO_IOS_VERSION = 'v1.0.134' broke WDA");
    expect(loadGoIosPin(makePluginDir(script))).toBe('v1.2.1');
  });

  it('reads the pin from an ES-module style declaration too', () => {
    expect(loadGoIosPin(makePluginDir("export const GO_IOS_VERSION = 'v1.5.0';\n"))).toBe('v1.5.0');
    expect(loadGoIosPin(makePluginDir("const GO_IOS_VERSION = 'v1.6.0';\n"))).toBe('v1.6.0');
  });

  it('returns null when only a comment mentions the pin', () => {
    expect(loadGoIosPin(makePluginDir("// GO_IOS_VERSION = 'v1.0.134' broke WDA\n"))).toBeNull();
  });

  it('picks up an in-place update of the file on the next call', () => {
    const dir = makePluginDir(COMPILED);
    expect(loadGoIosPin(dir)).toBe('v1.2.1');
    writeScript(dir, "exports.GO_IOS_VERSION = 'v1.3.0';");
    expect(loadGoIosPin(dir)).toBe('v1.3.0');
  });

  it('returns null when the plugin does not ship the version file', () => {
    expect(loadGoIosPin(makePluginDir())).toBeNull();
  });

  it('returns null when the plugin folder does not exist', () => {
    expect(loadGoIosPin(path.join(tmpdir(), 'xenon-no-such-plugin-dir'))).toBeNull();
  });

  it('returns null when the file does not export a pin', () => {
    expect(loadGoIosPin(makePluginDir('"use strict";\nexports.OTHER = 1;\n'))).toBeNull();
  });

  it('returns null when the pin is not a string', () => {
    expect(loadGoIosPin(makePluginDir('exports.GO_IOS_VERSION = 42;'))).toBeNull();
  });

  it('never executes the file it reads', () => {
    const dir = makePluginDir("exports.GO_IOS_VERSION = 'v9.9.9'; globalThis.__pinExecuted = true;");
    expect(loadGoIosPin(dir)).toBe('v9.9.9');
    expect((globalThis as { __pinExecuted?: boolean }).__pinExecuted).toBeUndefined();
  });
});
