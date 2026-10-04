import { expect } from 'chai';

// scripts/ is plain CommonJS that the export script also loads, so it is
// required rather than imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const site = require('../../scripts/lib/openapi-for-site');
const { forSite, VERSION_TOKEN, assertNoRawDocumentLink } = site;

/**
 * The documentation site publishes the server's OpenAPI document. The spec
 * names the version it was built from in `info`, so a committed copy would
 * change on every release. forSite swaps that version for a token the site's
 * build fills in, and points the "raw document" link at the user's own server,
 * since the link would otherwise lead to the docs host.
 */
describe('openapi for the documentation site', () => {
  const version = '2.13.1';
  const makeSpec = () => ({
    info: {
      version,
      description: `This reference describes version **${version}**. The raw OpenAPI document is at [\`/xenon/api-docs.json\`](/xenon/api-docs.json).`,
    },
    paths: { '/api/devices': {} },
  });

  it('puts the version token where the version was', () => {
    const result = forSite(makeSpec(), version);
    expect(result.info.version).to.equal('__XENON_VERSION__');
    expect(VERSION_TOKEN).to.equal('__XENON_VERSION__');
    expect(result.info.description).to.contain('version **__XENON_VERSION__**');
  });

  it('leaves no trace of the version anywhere in the result', () => {
    expect(JSON.stringify(forSite(makeSpec(), version))).to.not.contain(version);
  });

  it('points the raw-document line at the reader’s own server, with no link', () => {
    const { description } = forSite(makeSpec(), version).info;
    expect(description).to.contain('`/xenon/api-docs.json` on your server');
    expect(description).to.not.contain('](/xenon/api-docs.json)');
  });

  it('keeps the paths exactly as they were', () => {
    expect(forSite(makeSpec(), version).paths).to.deep.equal(makeSpec().paths);
  });

  it('does not change the object it is given', () => {
    const spec = makeSpec();
    forSite(spec, version);
    expect(spec).to.deep.equal(makeSpec());
  });

  it('refuses an empty or missing version', () => {
    expect(() => forSite(makeSpec(), '')).to.throw(/version/);
    expect(() => forSite(makeSpec(), undefined)).to.throw(/version/);
    expect(() => forSite(makeSpec(), 2.13)).to.throw(/version/);
  });

  it('only touches the version inside info', () => {
    const spec: any = makeSpec();
    spec.paths['/api/version'] = { get: { example: { pluginVersion: version } } };
    const result = forSite(spec, version);
    expect(result.paths['/api/version'].get.example.pluginVersion).to.equal(version);
  });

  describe('the guard against a link to the raw document', () => {
    const guarded = (description: string) => {
      const spec = makeSpec();
      spec.info.description = description;
      return JSON.stringify(forSite(spec, version), null, 2);
    };

    it('passes the introduction as the server writes it, once forSite has rewritten the link', () => {
      expect(() => assertNoRawDocumentLink(guarded(makeSpec().info.description))).to.not.throw();
    });

    it('catches the link when the introduction is reworded', () => {
      const text = guarded('Download the [raw document](/xenon/api-docs.json).');
      expect(() => assertNoRawDocumentLink(text)).to.throw(
        /still links to \/xenon\/api-docs\.json[\s\S]*src\/app\/swagger\.ts/,
      );
    });

    it('catches a link that has a space, an angle bracket or a fragment in its target', () => {
      expect(() => assertNoRawDocumentLink('a [b]( /xenon/api-docs.json)')).to.throw();
      expect(() => assertNoRawDocumentLink('a [b](</xenon/api-docs.json>)')).to.throw();
      expect(() => assertNoRawDocumentLink('a [b](/xenon/api-docs.json#info "title")')).to.throw();
    });

    it('lets plain code and other links through', () => {
      expect(() =>
        assertNoRawDocumentLink(
          'at `/xenon/api-docs.json` on your server, see [the profile](/xenon/profile)',
        ),
      ).to.not.throw();
    });
  });
});
