import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { useScratchDatabase } from '../helpers/scratch-database';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { loopbackServers } from '../helpers/loopbackServer';
import request from '../helpers/loopbackRequest';
import { saveRegistrations } from '../helpers/container-registration';
import { registerMcpEndpoint } from '../../src/mcp/mcpEndpoint';
import { mcpCredentialLog } from '../../src/mcp/mcpCredential';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { config } from '../../src/config';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import pkg from '../../package.json';

/**
 * `/xenon/mcp`: the hub's own MCP endpoint. It takes the header credentials
 * REST takes (a key pair, a bearer, Basic), never the dashboard cookie, and
 * answers a call without one with a challenge naming where to sign in.
 */
describe('the MCP endpoint (/xenon/mcp)', () => {
  useScratchDatabase({ wholeSuite: true });

  const servers = loopbackServers();
  let member: SeededUser;
  let keyPair: Record<string, string>;
  let savedAuthDisabled: boolean;
  let restoreContainer: () => void;
  const keyDirs: string[] = [];

  function appFor(pluginArgs: IPluginArgs = DefaultPluginArgs): express.Express {
    const router = express.Router();
    registerMcpEndpoint(router, pluginArgs);
    const app = express();
    app.use('/xenon', router);
    return app;
  }

  async function connect(headers: Record<string, string> = {}): Promise<Client> {
    const server: Server = await servers.serve(appFor());
    const { port } = server.address() as AddressInfo;
    const client = new Client({ name: 'mcp-endpoint-spec', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/xenon/mcp`), {
        requestInit: { headers },
      }),
    );
    return client;
  }

  async function keyService(): Promise<JwtKeyService> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-mcp-endpoint-'));
    keyDirs.push(dir);
    const svc = new JwtKeyService();
    await svc.init(dir);
    return svc;
  }

  before(async () => {
    member = await seedUser('MEMBER', { name: 'Agent Owner' });
    const key = await Container.get(ApiKeyService).create({
      name: 'agent',
      scopes: ['read', 'devices'],
      userId: member.user.id,
    });
    keyPair = { 'x-xenon-access-key': member.user.accessKey, 'x-xenon-token': key.raw };
  });

  beforeEach(() => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    restoreContainer = saveRegistrations(JwtKeyService, ApiKeyService);
  });

  afterEach(async () => {
    sinon.restore();
    config.authDisabled = savedAuthDisabled;
    restoreContainer();
    await servers.closeAll();
  });

  after(() => {
    for (const dir of keyDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists xenon_lab_info for a key-pair caller', async () => {
    const client = await connect(keyPair);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).to.include('xenon_lab_info');
    } finally {
      await client.close();
    }
  });

  it('answers xenon_lab_info with the caller and features', async () => {
    const client = await connect(keyPair);
    try {
      const result = (await client.callTool({ name: 'xenon_lab_info', arguments: {} })) as {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
      expect(result.isError).to.not.equal(true);
      const info = JSON.parse(result.content[0].text);
      expect(info.userId).to.equal(member.user.id);
      expect(info.role).to.equal('MEMBER');
      expect(info.teams).to.deep.equal([]);
      expect(info.scopes).to.be.an('array').that.includes('xenon:devices:read');
      expect(info.version).to.equal(pkg.version);
      expect(info.features.mcpServer.path).to.equal('/xenon/mcp');
      expect(info.features.mcpServer.tools).to.include('xenon_lab_info');
    } finally {
      await client.close();
    }
  });

  it('takes a xenon-mcp bearer token', async () => {
    const keys = await keyService();
    Container.set(JwtKeyService, keys);
    const token = await keys.sign(
      { sub: member.user.id, scopes: '', scope: 'xenon:devices:read' },
      { audience: 'xenon-mcp', ttlSeconds: 60 },
    );
    const client = await connect({ authorization: `Bearer ${token}` });
    try {
      const result = (await client.callTool({ name: 'xenon_lab_info', arguments: {} })) as {
        content: Array<{ type: string; text: string }>;
      };
      const info = JSON.parse(result.content[0].text);
      expect(info.userId).to.equal(member.user.id);
      expect(info.scopes).to.deep.equal(['xenon:devices:read']);
    } finally {
      await client.close();
    }
  });

  it('takes the key pair as Basic auth', async () => {
    const basic = Buffer.from(
      `${keyPair['x-xenon-access-key']}:${keyPair['x-xenon-token']}`,
    ).toString('base64');
    const client = await connect({ authorization: `Basic ${basic}` });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).to.include('xenon_lab_info');
    } finally {
      await client.close();
    }
  });

  it('refuses no credential with 401 and a resource-metadata challenge', async () => {
    const res = await request(appFor())
      .post('/xenon/mcp')
      .set('accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).to.equal(401);
    expect(res.headers['www-authenticate']).to.match(
      /^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/xenon\/mcp"/,
    );
  });

  it('refuses a wrong key pair with 401', async () => {
    const res = await request(appFor())
      .post('/xenon/mcp')
      .set('x-xenon-access-key', keyPair['x-xenon-access-key'])
      .set('x-xenon-token', 'not-the-token')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).to.equal(401);
  });

  it('refuses the dashboard cookie alone with 401', async () => {
    const res = await request(appFor())
      .post('/xenon/mcp')
      .set('cookie', member.cookie)
      .set('accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).to.equal(401);
  });

  it("answers 503 when the signing key isn't ready", async () => {
    const token = await (
      await keyService()
    ).sign({ sub: member.user.id }, { audience: 'xenon-mcp', ttlSeconds: 60 });
    const notReady = new JwtKeyService();
    expect(notReady.ready).to.equal(false);
    Container.set(JwtKeyService, notReady);
    const res = await request(appFor())
      .post('/xenon/mcp')
      .set('authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({ error: 'unavailable' });
  });

  it('logs a credential check that throws and answers 503', async () => {
    const warn = sinon.stub(mcpCredentialLog, 'warn');
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().rejects(new Error('database is locked')),
    } as any);
    const res = await request(appFor())
      .post('/xenon/mcp')
      .set(keyPair)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({ error: 'unavailable' });
    expect(warn.calledOnce).to.equal(true);
    expect(String(warn.firstCall.args[0])).to.include('database is locked');
  });

  it("refuses a request from another page's origin with 403, before its credential", async () => {
    const res = await request(appFor())
      .post('/xenon/mcp')
      .set(keyPair)
      .set('origin', 'https://evil.example')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).to.equal(403);
    expect(res.body).to.deep.equal({ error: 'forbidden_origin' });
  });

  it("takes a request from this server's own origin", async () => {
    // Its own origin is the request's only while XENON_PUBLIC_URL is unset.
    const savedPublicUrl = config.publicUrl;
    config.publicUrl = undefined;
    try {
      await ownOriginIsTaken();
    } finally {
      config.publicUrl = savedPublicUrl;
    }
  });

  async function ownOriginIsTaken() {
    const server: Server = await servers.serve(appFor());
    const { port } = server.address() as AddressInfo;
    const res = await request(`http://127.0.0.1:${port}`)
      .post('/xenon/mcp')
      .set(keyPair)
      .set('origin', `http://127.0.0.1:${port}`)
      .set('accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'spec', version: '1.0.0' },
        },
      });
    expect(res.status).to.equal(200);
  }

  it('answers GET with 405', async () => {
    const res = await request(appFor()).get('/xenon/mcp').set(keyPair);
    expect(res.status).to.equal(405);
  });

  it('answers DELETE with 405', async () => {
    const res = await request(appFor()).delete('/xenon/mcp').set(keyPair);
    expect(res.status).to.equal(405);
  });

  it('is not registered on a node', async () => {
    const res = await request(appFor({ ...DefaultPluginArgs, hub: 'http://hub.example:4723' }))
      .post('/xenon/mcp')
      .set(keyPair)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).to.equal(404);
  });

  it('serves every tool with auth disabled', async () => {
    config.authDisabled = true;
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).to.include('xenon_lab_info');
    } finally {
      await client.close();
    }
  });
});
