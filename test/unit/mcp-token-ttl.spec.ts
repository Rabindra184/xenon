import { expect } from 'chai';
import sinon from 'sinon';
import { DEFAULT_MCP_TOKEN_TTL_SEC, mcpTokenTtlSec } from '../../src/services/token/mcpTokenTtl';

/**
 * XENON_MCP_TOKEN_TTL_SEC=abc made every xenon-mcp token's lifetime NaN.
 * A value that isn't a whole number of seconds above 0 now warns and keeps
 * the default.
 */
describe('XENON_MCP_TOKEN_TTL_SEC', () => {
  it('is the default (a day) when unset or empty, without a warning', () => {
    const warn = sinon.stub();
    expect(mcpTokenTtlSec(undefined, warn)).to.equal(86400);
    expect(mcpTokenTtlSec('', warn)).to.equal(86400);
    expect(mcpTokenTtlSec('  ', warn)).to.equal(86400);
    expect(DEFAULT_MCP_TOKEN_TTL_SEC).to.equal(86400);
    expect(warn.called).to.equal(false);
  });

  it('is the number of seconds it gives', () => {
    const warn = sinon.stub();
    expect(mcpTokenTtlSec('3600', warn)).to.equal(3600);
    expect(mcpTokenTtlSec(' 120 ', warn)).to.equal(120);
    expect(warn.called).to.equal(false);
  });

  for (const bad of ['abc', '0', '-60', '1.5', '1e400', 'Infinity', '12s']) {
    it(`warns and keeps the default for "${bad}"`, () => {
      const warn = sinon.stub();
      expect(mcpTokenTtlSec(bad, warn)).to.equal(86400);
      expect(warn.calledOnce).to.equal(true);
      expect(warn.firstCall.args[0]).to.include('XENON_MCP_TOKEN_TTL_SEC');
      expect(warn.firstCall.args[0]).to.include(bad);
    });
  }
});
