// Mocha config. JavaScript rather than JSON so it can decide one thing at
// runtime: whether to turn off Node's built-in TypeScript type stripping.
//
// From Node 22.18 (and 23.6) Node strips TS types itself. Mocha loads each
// spec with import() first and only falls back to ts-node's require() when
// Node rejects `.ts`, so on those versions every spec bypasses ts-node. Specs
// that use syntax Node can't strip (constructor parameter properties, enums)
// then fail to load and abort the whole run, and extensionless dynamic
// import() stops resolving. Turning stripping off puts ts-node back in charge.
//
// The flag is a "bad option" on Node versions without type stripping (all of
// Node 20), so it's added only when this Node recognises it.
const nodeOptions = process.allowedNodeEnvironmentFlags.has('--no-experimental-strip-types')
  ? ['no-experimental-strip-types']
  : [];

module.exports = {
  require: ['ts-node/register'],
  timeout: 60000,
  exit: true,
  extension: ['ts', 'js', 'tsx'],
  recursive: true,
  reporter: 'spec',
  ...(nodeOptions.length ? { 'node-option': nodeOptions } : {}),
};
