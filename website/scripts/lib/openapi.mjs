// The API reference's OpenAPI document, as the site serves it.
//
// website/openapi.json is exported from the server's own spec
// (`npm run build:openapi` at the repository root) and carries the token below
// where the plugin's version goes. The token keeps a release's version bump
// from changing a committed file; generate.mjs puts the current version in the
// copy the site serves from static/.

// The same string as VERSION_TOKEN in ../../../scripts/lib/openapi-for-site.js,
// which writes it. This file is ES module code in a package of its own, so it
// can't require that one.
export const VERSION_TOKEN = '__XENON_VERSION__';

export function withVersion(specText, version) {
  if (typeof version !== 'string' || version === '') {
    throw new Error(`withVersion needs a version, got ${JSON.stringify(version)}`);
  }
  // split/join, not replace(): a version is never a pattern, and `$&` in the
  // text must stay as written.
  return specText.split(VERSION_TOKEN).join(version);
}
