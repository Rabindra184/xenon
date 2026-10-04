'use strict';

/**
 * The OpenAPI document as the documentation site publishes it.
 *
 * The server's spec (src/app/swagger.ts) names the version it was built from,
 * in `info.version` and again in the introduction. Committed as it is, the
 * copy under website/ would change with every release and fail the drift
 * check on a version bump alone. So the version is swapped for a token, and
 * the site's build (website/scripts/generate.mjs) puts the current one back.
 *
 * The introduction also links to the raw document on the server it describes.
 * On the documentation site that link would lead to the docs host, so it
 * becomes a plain path, "on your server".
 *
 * Only `info` is touched: an example elsewhere that happens to show a version
 * is an example, not this server's version.
 */

const VERSION_TOKEN = '__XENON_VERSION__';

const RAW_DOCUMENT_LINK = '[`/xenon/api-docs.json`](/xenon/api-docs.json)';
const RAW_DOCUMENT_ON_YOUR_SERVER = '`/xenon/api-docs.json` on your server';

function replaceInStrings(value, from, to) {
  if (typeof value === 'string') return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((item) => replaceInStrings(item, from, to));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = replaceInStrings(item, from, to);
    return out;
  }
  return value;
}

/**
 * @param {object} spec    the OpenAPI document, as swaggerSpec holds it
 * @param {string} version the version `spec.info` was built from
 * @returns {object} a copy for the site; `spec` is not changed
 */
function forSite(spec, version) {
  const copy = JSON.parse(JSON.stringify(spec));
  if (copy.info) {
    copy.info = replaceInStrings(copy.info, RAW_DOCUMENT_LINK, RAW_DOCUMENT_ON_YOUR_SERVER);
    copy.info = replaceInStrings(copy.info, version, VERSION_TOKEN);
  }
  return copy;
}

module.exports = { forSite, VERSION_TOKEN, RAW_DOCUMENT_LINK };
