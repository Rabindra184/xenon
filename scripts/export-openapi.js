'use strict';

/**
 * Writes the server's OpenAPI document to website/openapi.json, for the
 * documentation site's API reference. Run it with `npm run build:openapi`
 * after changing src/app/swagger.ts or anything in src/app/openapi/.
 *
 * The committed file carries no version (see lib/openapi-for-site.js), so a
 * release's version bump leaves it as it is. CI regenerates it and fails when
 * it differs from what is committed (Schema Drift Check).
 */

const fs = require('fs');
const path = require('path');

require('ts-node').register({ transpileOnly: true });

const { swaggerSpec } = require('../src/app/swagger');
const { forSite, assertNoRawDocumentLink } = require('./lib/openapi-for-site');
const { version } = require('../package.json');

const target = path.join(__dirname, '..', 'website', 'openapi.json');

const text = `${JSON.stringify(forSite(swaggerSpec, version), null, 2)}\n`;

// forSite rewrites the introduction's link to the raw document by its exact
// text. If the introduction is reworded, the link would stay and lead to the
// documentation site, so refuse to write the file.
assertNoRawDocumentLink(text);

fs.writeFileSync(target, text);
console.log(`wrote ${path.relative(process.cwd(), target)}`);
