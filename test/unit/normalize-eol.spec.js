const { expect } = require('chai');
const { stripCrlfToLf, isNormalizableTextFile } = require('../../scripts/lib/normalize-eol');

// The Prisma client is committed with LF, but @prisma/client ships some runtime
// *.d.ts files with CRLF, so `prisma generate` rewrites them CRLF and Git shows
// perpetual empty-diff churn. generate-prisma.js and check-client-freshness.js
// use these helpers to normalize generated text to LF (never touching the native
// query-engine .node binaries).
describe('stripCrlfToLf', () => {
  it('converts CRLF to LF', () => {
    expect(stripCrlfToLf(Buffer.from('a\r\nb\r\n')).toString()).to.equal('a\nb\n');
  });

  it('leaves LF-only content unchanged', () => {
    expect(stripCrlfToLf(Buffer.from('a\nb\n')).toString()).to.equal('a\nb\n');
  });

  it('preserves a lone CR not followed by LF', () => {
    expect(stripCrlfToLf(Buffer.from('a\rb')).toString()).to.equal('a\rb');
  });

  it('preserves multibyte UTF-8 bytes while dropping the CR', () => {
    // café + CRLF: the é is c3 a9; only the 0x0D before 0x0A must be removed.
    expect(stripCrlfToLf(Buffer.from('café\r\n', 'utf8')).toString('utf8')).to.equal('café\n');
  });

  it('is a no-op on empty input', () => {
    expect(stripCrlfToLf(Buffer.from('')).length).to.equal(0);
  });
});

describe('isNormalizableTextFile', () => {
  it('treats generated declaration / js / json / prisma files as text', () => {
    ['library.d.ts', 'index-browser.d.ts', 'index.js', 'package.json', 'schema.prisma'].forEach(
      (f) => expect(isNormalizableTextFile(f), f).to.equal(true),
    );
  });

  it('never normalizes prisma query-engine binaries', () => {
    [
      'libquery_engine-darwin-arm64.dylib.node',
      'libquery_engine-debian-openssl-3.0.x.so.node',
    ].forEach((f) => expect(isNormalizableTextFile(f), f).to.equal(false));
  });
});
