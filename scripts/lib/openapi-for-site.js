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

// Any Markdown link whose target is the raw document, however its text is
// worded: forSite rewrites only the one exact sentence above.
const RAW_DOCUMENT_LINK_PATTERN = /\]\(\s*<?\/xenon\/api-docs\.json[^)]*\)/;

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
  if (typeof version !== 'string' || version === '') {
    throw new Error(
      `forSite needs the version spec.info was built from, got ${JSON.stringify(version)}`,
    );
  }
  const copy = JSON.parse(JSON.stringify(spec));
  if (copy.info) {
    copy.info = replaceInStrings(copy.info, RAW_DOCUMENT_LINK, RAW_DOCUMENT_ON_YOUR_SERVER);
    copy.info = replaceInStrings(copy.info, version, VERSION_TOKEN);
  }
  return copy;
}

/**
 * Throws if the document still links to the raw document on the server it
 * describes. On the documentation site that link leads to the docs host,
 * where there is no such file. forSite rewrites the introduction's one known
 * wording; this catches the introduction (or any description) being reworded.
 *
 * @param {string} text the document as JSON text, after forSite
 */
function assertNoRawDocumentLink(text) {
  const match = RAW_DOCUMENT_LINK_PATTERN.exec(text);
  if (!match) return;
  const around = text.slice(Math.max(0, match.index - 40), match.index + match[0].length);
  throw new Error(
    `The OpenAPI document still links to /xenon/api-docs.json (…${around}), which would lead to ` +
      'the documentation site, where there is no such file. In src/app/swagger.ts, write ' +
      'the sentence as plain code, or change RAW_DOCUMENT_LINK in ' +
      'scripts/lib/openapi-for-site.js to the new wording so forSite rewrites it.',
  );
}

module.exports = { forSite, VERSION_TOKEN, assertNoRawDocumentLink };
