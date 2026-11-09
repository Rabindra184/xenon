import 'reflect-metadata';
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
      commandAuth: false,
      leasing: caps.features.leasing,
      tokenLogFilter: caps.features.tokenLogFilter,
      aiRedaction: { builtIn: [], rules: 0, screenshots: 'send', valid: true },
      traceContext: { accepted: true, exporting: false },
      appReuse: true,
    });
  });

  it('traceContext says whether this server exports the spans that join a trace', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sinon = require('sinon');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TracingService } = require('../../src/services/TracingService');
    const stub = sinon.stub(TracingService.prototype, 'exportsTraces').returns(true);
    try {
      expect(buildCapabilities().features.traceContext).to.deep.equal({
        accepted: true,
        exporting: true,
      });
    } finally {
      stub.restore();
    }
  });

  it("tokenLogFilter says whether the server's log-filters hide a create's tokens", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { noteServerLogFilters } = require('../../src/services/logging/tokenLogFilter');
    try {
      noteServerLogFilters([
        {
          pattern: '([Tt]oken\\\\?["\']?\\s*:\\s*\\\\?["\']?)[A-Za-z0-9._~+/=-]+',
          flags: 'g',
          replacer: '$1**REDACTED**',
        },
      ]);
      expect(buildCapabilities().features.tokenLogFilter).to.equal(true);
      noteServerLogFilters(undefined);
      expect(buildCapabilities().features.tokenLogFilter).to.equal(false);
    } finally {
      noteServerLogFilters(undefined);
    }
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

  it('commandAuth reflects XENON_REQUIRE_COMMAND_AUTH', () => {
    process.env.XENON_REQUIRE_COMMAND_AUTH = 'true';
    try {
      expect(buildCapabilities().features.commandAuth).to.equal(true);
    } finally {
      delete process.env.XENON_REQUIRE_COMMAND_AUTH;
    }
  });
});
