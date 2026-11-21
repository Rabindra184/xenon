import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { buildCapabilities } from '../../src/app/routers/capabilities';
import { PluginContext } from '../../src/PluginContext';
import { config } from '../../src/config';

describe('capabilities payload', () => {
  let savedAuthDisabled: boolean;
  beforeEach(() => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
  });
  afterEach(() => {
    config.authDisabled = savedAuthDisabled;
  });

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
      traceContext: { accepted: true, exporting: false, forwardedCommands: true },
      appReuse: true,
      ciAppStore: true,
      networkProfiles: {
        midSession: true,
        appTraffic: {
          androidEmulator: ['Normal', '4G', '3G', 'Edge', 'Offline'],
          androidDevice: ['Normal', '4G', '3G', 'Edge', 'Offline'],
          ios: [],
        },
        proxyShaped: ['androidDevice'],
      },
      recording: { observer: true },
      phoneIdentity: { hostParameter: true, events: true },
      mcpServer: {
        path: '/xenon/mcp',
        oauth: true,
        contractVersion: 2,
        tools: [
          'xenon_lab_info',
          'xenon_list_devices',
          'xenon_acquire_device',
          'xenon_release_device',
          'xenon_extend_device',
          'xenon_selector_health',
          'xenon_healing_events',
          'xenon_start_recording',
          'xenon_stop_recording',
          'xenon_execute_script',
          'xenon_session_capabilities',
        ],
      },
    });
  });

  it('mcpServer says where the MCP endpoint is and which tools it serves', () => {
    expect(buildCapabilities().features.mcpServer).to.deep.equal({
      path: '/xenon/mcp',
      oauth: true,
      contractVersion: 2,
      tools: [
        'xenon_lab_info',
        'xenon_list_devices',
        'xenon_acquire_device',
        'xenon_release_device',
        'xenon_extend_device',
        'xenon_selector_health',
        'xenon_healing_events',
        'xenon_start_recording',
        'xenon_stop_recording',
        'xenon_execute_script',
        'xenon_session_capabilities',
      ],
    });
  });

  it('mcpServer.oauth is false with auth disabled: there is no sign-in to offer', () => {
    config.authDisabled = true;
    expect(buildCapabilities().features.mcpServer?.oauth).to.equal(false);
    config.authDisabled = false;
    expect(buildCapabilities().features.mcpServer?.oauth).to.equal(true);
  });

  it("answered to a request, mcpServer.url is this server's MCP endpoint as agents reach it", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const express = require('express');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const request = require('../helpers/loopbackRequest').default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { capabilitiesRouter } = require('../../src/app/routers/capabilities');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../../src/config');
    const app = express();
    app.use('/xenon/api/capabilities', capabilitiesRouter());

    const plain = await request(app).get('/xenon/api/capabilities');
    expect(plain.body.features.mcpServer.url).to.match(/^http:\/\/127\.0\.0\.1:\d+\/xenon\/mcp$/);

    // XENON_PUBLIC_URL names it when set: the OAuth `resource` must be this.
    const saved = config.publicUrl;
    config.publicUrl = 'https://xenon.example.com/xenon/';
    try {
      const named = await request(app).get('/xenon/api/capabilities');
      expect(named.body.features.mcpServer.url).to.equal('https://xenon.example.com/xenon/mcp');
    } finally {
      config.publicUrl = saved;
    }
  });

  it("doesn't report mcpServer on a node, which doesn't serve /xenon/mcp", () => {
    const context = Container.get(PluginContext);
    const saved = context.pluginArgs;
    context.pluginArgs = { ...saved, hub: 'http://hub.example:4723' };
    try {
      expect(buildCapabilities().features).to.not.have.property('mcpServer');
    } finally {
      context.pluginArgs = saved;
    }
  });

  it('phoneIdentity says a phone can be named by udid and host, in requests and live events', () => {
    expect(buildCapabilities().features.phoneIdentity).to.deep.equal({
      hostParameter: true,
      events: true,
    });
  });

  it("recording.observer says POST /recordings takes the caller's session ids", () => {
    expect(buildCapabilities().features.recording).to.deep.equal({ observer: true });
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
        forwardedCommands: true,
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
