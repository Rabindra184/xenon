import 'reflect-metadata';
import { expect } from 'chai';
import * as jose from 'jose';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { issueToken } from '../../src/app/routers/auth';
import { McpScopeError } from '../../src/services/token/mcpScopes';

describe('POST /auth/token handler (issueToken)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-tok-'));
    const svc = new JwtKeyService();
    await svc.init(dir);
    Container.set(JwtKeyService, svc);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    Container.reset();
  });

  const auth = {
    kind: 'api-key',
    userId: 'u1',
    role: 'MEMBER',
    scopes: 'devices,read',
    teamId: 't1',
    rateLimit: 300,
  } as any;

  it('mints a xenon-rest token by default with 3600s TTL', async () => {
    const out = await issueToken(auth, {});
    expect(out.audience).to.equal('xenon-rest');
    expect(out.expiresIn).to.equal(3600);
    const payload = await Container.get(JwtKeyService).verify(out.token, {
      audience: 'xenon-rest',
    });
    expect(payload.sub).to.equal('u1');
    expect(payload.scopes).to.equal('devices,read');
    expect(payload.teamId).to.equal('t1');
  });

  it('mints a xenon-mcp token with 86400s TTL', async () => {
    const out = await issueToken(auth, { audience: 'xenon-mcp' });
    expect(out.expiresIn).to.equal(86400);
    await Container.get(JwtKeyService).verify(out.token, { audience: 'xenon-mcp' });
  });

  it('rejects unknown audiences', async () => {
    try {
      await issueToken(auth, { audience: 'xenon-stream' }); // tickets are not minted here
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).to.match(/audience/);
    }
  });
});

describe('issueToken (xenon-mcp granular claims)', () => {
  const auth = { userId: 'u1', role: 'MEMBER', scopes: 'devices,sessions,read', teamId: 't1' };

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwtkeys-'));
    await Container.get(JwtKeyService).init(dir);
  });

  async function decode(token: string): Promise<jose.JWTPayload> {
    // decodeJwt skips signature verification — fine for claim-shape assertions
    return jose.decodeJwt(token);
  }

  it('xenon-rest tokens are unchanged (flat scopes verbatim, no scope/roles claims)', async () => {
    const out = await issueToken(auth, { audience: 'xenon-rest' });
    const p = await decode(out.token);
    expect(p.scopes).to.equal('devices,sessions,read');
    expect(p.scope).to.equal(undefined);
    expect(p.roles).to.equal(undefined);
    expect((out as any).scopes).to.equal(undefined);
  });

  it('xenon-mcp default mints least-scope granular claims and down-mapped flat scopes', async () => {
    const out = await issueToken(auth, { audience: 'xenon-mcp' });
    const p = await decode(out.token);
    expect(p.scope).to.equal('appium:use xenon:devices:read');
    expect(p.roles).to.deep.equal([]);
    // appium:use→sessions; xenon:devices:read is role-gated-only → no flat scope
    expect(p.scopes).to.equal('sessions');
    expect((out as any).scopes).to.deep.equal(['appium:use', 'xenon:devices:read']);
  });

  it('xenon-mcp honors requested scopes within the ceiling', async () => {
    const out = await issueToken(auth, {
      audience: 'xenon-mcp',
      scopes: ['xenon:devices:lock', 'xenon:devices:read'],
    });
    const p = await decode(out.token);
    expect(p.scope).to.equal('xenon:devices:lock xenon:devices:read');
    // lock→devices; read is role-gated-only → no flat scope
    expect(p.scopes).to.equal('devices');
  });

  it('propagates McpScopeError for a request exceeding the key', async () => {
    try {
      await issueToken({ ...auth, scopes: 'read' }, { audience: 'xenon-mcp', scopes: ['xenon:recordings'] });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(McpScopeError);
      expect(e.code).to.equal('scope_exceeds_key');
    }
  });
});
