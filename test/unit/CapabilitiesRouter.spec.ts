import { expect } from 'chai';
import { buildCapabilities } from '../../src/app/routers/capabilities';

describe('capabilities payload', () => {
  it('reports version and the hub feature set', () => {
    const caps = buildCapabilities();
    expect(caps.version).to.be.a('string').and.not.equal('');
    expect(caps.features).to.deep.equal({
      bearerAuth: true,
      tokenIssuance: true,
      streamTickets: true,
      leases: true,
      eventLog: true,
      projects: true,
      mcpScopedTokens: true,
      sessionTokenGate: false,
    });
  });

  it('advertises 2b hosted-MCP features', () => {
    const caps = buildCapabilities();
    expect(caps.features.mcpScopedTokens).to.equal(true);
    expect(caps.features.sessionTokenGate).to.be.a('boolean');
  });

  it('sessionTokenGate reflects XENON_REQUIRE_SESSION_TOKEN', () => {
    process.env.XENON_REQUIRE_SESSION_TOKEN = '1';
    try {
      expect(buildCapabilities().features.sessionTokenGate).to.equal(true);
    } finally {
      delete process.env.XENON_REQUIRE_SESSION_TOKEN;
    }
  });
});
