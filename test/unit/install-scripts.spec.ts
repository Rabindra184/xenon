import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * npm 12 runs a dependency's install scripts only when the project installing
 * it allows them (`allowScripts` in its package.json), and skips the rest with
 * a warning. Appium installs a plugin with npm into its own home, whose
 * package.json allows nothing, so every install script in Xenon's tree is
 * skipped there and `appium plugin install` still reports success.
 *
 * Through 2.17 passwords were hashed with `bcrypt`, whose native binary only
 * its `install` script downloads. Installed with npm 12, the plugin then
 * failed to load: "Cannot find module .../bcrypt/lib/binding/napi-v3/bcrypt_lib.node".
 *
 * Each package here has an install script and works without it, for the
 * reason given, checked with npm 12. A new one needs its own reason, checked
 * the same way, or a replacement that needs no script.
 */
const WORKS_WITHOUT_ITS_SCRIPT: Record<string, string> = {
  '@ffmpeg-installer/*': 'chmod u+x ffmpeg: every platform package ships ffmpeg executable already',
  '@prisma/client':
    'generates the default client in node_modules/.prisma; Xenon imports its own (src/generated/client)',
  '@prisma/engines':
    "downloads Prisma's engines: the schema engine is fetched on its first use at startup, " +
    'and the generated client carries its query engines',
  '@scarf/scarf': "swagger-ui-dist's install analytics",
  'appium-chromedriver':
    'downloads a Chromedriver; Xenon downloads its own when needed (ChromeDriverManager)',
  prisma: 'warns about incompatible older Prisma packages',
  protobufjs: 'warns about a dependent pinned to another version scheme',
  sharp: 'checks for its prebuilt binary, which comes in an @img/sharp-* package with no script',
  'tesseract.js': 'prints an Open Collective notice',
};

const matches = (key: string, name: string) =>
  key.endsWith('/*') ? name.startsWith(key.slice(0, -1)) : name === key;
const nameOf = (id: string) => id.slice(0, id.lastIndexOf('@'));

/** Where Node would find `name` from `from`: its node_modules, then each parent's. */
function packageDir(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * Every package Xenon runs with (its dependencies, theirs, and so on, as
 * installed) that has an install script: `preinstall`, `install` or
 * `postinstall`, or a `binding.gyp`, which npm builds with `node-gyp rebuild`
 * when no script says otherwise. An optional dependency for another platform
 * isn't installed, and is left out.
 */
function packagesWithInstallScripts(): Map<string, string> {
  const found = new Map<string, string>();
  const seen = new Set<string>();
  const runtimeDeps = (pkg: any) =>
    Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
  const queue = runtimeDeps(readJson(path.join(root, 'package.json'))).map((name) => ({
    name,
    from: root,
  }));
  for (let next = queue.shift(); next; next = queue.shift()) {
    const { name, from } = next;
    const dir = packageDir(name, from);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const pkg = readJson(path.join(dir, 'package.json'));
    const scripts = ['preinstall', 'install', 'postinstall']
      .filter((hook) => pkg.scripts?.[hook])
      .map((hook) => `${hook}: ${pkg.scripts[hook]}`);
    if (scripts.length === 0 && fs.existsSync(path.join(dir, 'binding.gyp'))) {
      scripts.push('binding.gyp: node-gyp rebuild');
    }
    if (scripts.length > 0) found.set(`${pkg.name}@${pkg.version}`, scripts.join(' | '));
    queue.push(...runtimeDeps(pkg).map((dep) => ({ name: dep, from: dir })));
  }
  return found;
}

describe('install scripts in the runtime dependency tree', () => {
  const found = packagesWithInstallScripts();
  const keys = Object.keys(WORKS_WITHOUT_ITS_SCRIPT);

  it('belong only to packages that work without them, since npm 12 skips them', () => {
    const unexplained = [...found]
      .filter(([id]) => !keys.some((key) => matches(key, nameOf(id))))
      .map(([id, scripts]) => `${id} (${scripts})`);
    expect(unexplained).to.deep.equal([]);
  });

  it('name no package the tree no longer has', () => {
    const names = [...found.keys()].map(nameOf);
    const stale = keys.filter((key) => !names.some((name) => matches(key, name)));
    expect(stale).to.deep.equal([]);
  });
});
