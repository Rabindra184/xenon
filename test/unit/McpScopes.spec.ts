import { expect } from 'chai';
import {
  resolveMcpGrant,
  McpScopeError,
  ALL_GRANULAR_SCOPES,
  DEFAULT_MCP_SCOPES,
} from '../../src/services/token/mcpScopes';

describe('mcpScopes.resolveMcpGrant', () => {
  it('default grant is the least-scope set intersected with the key ceiling', () => {
    // spec §7.1: day-to-day authoring mints appium:use + xenon:devices:read only
    const g = resolveMcpGrant('devices,sessions,read');
    expect(g.granular.sort()).to.deep.equal(['appium:use', 'xenon:devices:read']);
    expect(g.roles).to.deep.equal([]);
  });

  it('read-only key defaults to xenon:devices:read only (appium:use not in ceiling)', () => {
    const g = resolveMcpGrant('read');
    expect(g.granular).to.deep.equal(['xenon:devices:read']);
    expect(g.flat).to.deep.equal([]);
  });

  it('sessions-only key defaults to appium:use only', () => {
    const g = resolveMcpGrant('sessions');
    expect(g.granular).to.deep.equal(['appium:use']);
    expect(g.flat).to.deep.equal(['sessions']);
  });

  it('explicit request within ceiling is granted verbatim (sorted, deduped)', () => {
    const g = resolveMcpGrant('devices,sessions,read', [
      'xenon:recordings', 'xenon:devices:lock', 'xenon:recordings',
    ]);
    expect(g.granular).to.deep.equal(['xenon:devices:lock', 'xenon:recordings']);
    // down-map: lock→devices; recordings hits a role-gated-only endpoint, no flat scope
    expect(g.flat).to.deep.equal(['devices']);
  });

  it('request exceeding the key ceiling throws scope_exceeds_key naming offenders', () => {
    try {
      resolveMcpGrant('read', ['xenon:devices:lock']);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(McpScopeError);
      expect(e.code).to.equal('scope_exceeds_key');
      expect(e.message).to.include('xenon:devices:lock');
    }
  });

  it('unknown scope names throw unknown_scope', () => {
    try {
      resolveMcpGrant('admin', ['xenon:bogus']);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(McpScopeError);
      expect(e.code).to.equal('unknown_scope');
      expect(e.message).to.include('xenon:bogus');
    }
  });

  it('admin key granted the FULL granular set gets roles ["admin"] and flat includes admin', () => {
    const g = resolveMcpGrant('admin', [...ALL_GRANULAR_SCOPES]);
    expect(g.granular.sort()).to.deep.equal([...ALL_GRANULAR_SCOPES].sort());
    expect(g.roles).to.deep.equal(['admin']);
    expect(g.flat).to.include('admin');
  });

  it('admin key with the DEFAULT (narrowed) grant does NOT get the admin role', () => {
    // least-privilege: gateway admin bypass only when full power was explicitly requested
    const g = resolveMcpGrant('admin');
    expect(g.granular.sort()).to.deep.equal([...DEFAULT_MCP_SCOPES].sort());
    expect(g.roles).to.deep.equal([]);
    expect(g.flat).to.not.include('admin');
  });

  it('empty requested array behaves like undefined (default grant)', () => {
    expect(resolveMcpGrant('devices,sessions', []).granular)
      .to.deep.equal(resolveMcpGrant('devices,sessions').granular);
  });

  it('unknown flat scopes in the key are ignored, not fatal', () => {
    const g = resolveMcpGrant('read,bogusflat');
    expect(g.granular).to.deep.equal(['xenon:devices:read']);
  });

  it('key whose ceiling cannot satisfy any default scope throws scope_exceeds_key', () => {
    // a key with no recognized flat scopes has an empty ceiling
    expect(() => resolveMcpGrant('')).to.throw(McpScopeError);
  });

  describe('xenon:execute (the xenon_execute_script tool)', () => {
    it('is a scope the endpoint knows, so asking for it is never unknown_scope', () => {
      expect(ALL_GRANULAR_SCOPES).to.include('xenon:execute');
    });

    it('a sessions key may grant it, with appium:use, and it adds no flat scope', () => {
      const g = resolveMcpGrant('sessions', ['appium:use', 'xenon:execute']);
      expect(g.granular).to.deep.equal(['appium:use', 'xenon:execute']);
      expect(g.flat).to.deep.equal(['sessions']); // from appium:use alone
      expect(resolveMcpGrant('sessions', ['xenon:execute']).flat).to.deep.equal([]);
    });

    it('read and devices keys may not: they open no session for it to run on', () => {
      for (const key of ['read', 'devices', 'read,devices']) {
        try {
          resolveMcpGrant(key, ['xenon:execute']);
          throw new Error('should have thrown');
        } catch (e: any) {
          expect(e).to.be.instanceOf(McpScopeError);
          expect(e.code).to.equal('scope_exceeds_key');
          expect(e.message).to.include('xenon:execute');
        }
      }
    });

    it('is not in the default grant: an agent gets it only when asked for', () => {
      expect(DEFAULT_MCP_SCOPES).to.not.include('xenon:execute');
      expect(resolveMcpGrant('admin').granular).to.not.include('xenon:execute');
      expect(resolveMcpGrant('devices,sessions,read').granular).to.not.include('xenon:execute');
    });

    it('an admin asking for every scope but it is not full admin', () => {
      // The gateway's admin role bypasses every tool's scope, xenon_execute_script's
      // included, so a token without xenon:execute must not carry it.
      const g = resolveMcpGrant(
        'admin',
        ALL_GRANULAR_SCOPES.filter((s) => s !== 'xenon:execute'),
      );
      expect(g.roles).to.deep.equal([]);
      expect(g.flat).to.not.include('admin');
    });
  });

  it('down-map never exceeds the key: devices-only + recordings adds no flat scope', () => {
    const g = resolveMcpGrant('devices', ['xenon:recordings']);
    expect(g.granular).to.deep.equal(['xenon:recordings']);
    expect(g.flat).to.deep.equal([]); // NOT ['sessions'] — escalation closed
  });
});
