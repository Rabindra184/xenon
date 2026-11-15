import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { InvalidClientError, OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { useScratchDatabase } from '../helpers/scratch-database';
import { prisma } from '../../src/prisma';
import {
  ClientStore,
  MAX_REGISTERED_CLIENTS,
  redirectUriProblem,
} from '../../src/services/oauth/clientStore';
import { ClientMetadataRefused } from '../../src/services/oauth/clientMetadataDocument';

const DAY = 24 * 60 * 60 * 1000;

/** What the SDK's registration handler passes to registerClient. */
function registration(overrides: Partial<OAuthClientInformationFull> = {}) {
  return {
    client_id: 'c0ffee00-0000-4000-8000-000000000000',
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret: 'generated-by-the-sdk',
    client_secret_expires_at: 0,
    client_name: 'Claude Code',
    redirect_uris: ['http://127.0.0.1:33418/callback'],
    ...overrides,
  } as OAuthClientInformationFull;
}

async function oauthError(promise: Promise<unknown>): Promise<OAuthError> {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(OAuthError);
    return err as OAuthError;
  }
  throw new Error('expected an OAuth error');
}

/**
 * Agents registered for browser sign-in (RFC 7591), and agents named by a
 * client ID metadata document. Every one is a public client: PKCE proves the
 * agent, and the hub keeps no secret.
 */
describe('the sign-in client store', () => {
  useScratchDatabase();

  let store: ClientStore;
  beforeEach(async () => {
    await prisma.mcpClient.deleteMany({});
    store = new ClientStore();
  });
  afterEach(() => sinon.restore());

  it('registers a public client and keeps no secret', async () => {
    const info = await store.registerClient(registration());
    expect(info.client_id).to.match(/^[0-9a-f-]{36}$/);
    expect(info.client_id).to.not.equal('c0ffee00-0000-4000-8000-000000000000');
    expect(info).to.not.have.property('client_secret');
    expect(info).to.not.have.property('client_secret_expires_at');
    expect(info.token_endpoint_auth_method).to.equal('none');
    expect(info.client_name).to.equal('Claude Code');

    const found = await store.getClient(info.client_id);
    expect(found?.redirect_uris).to.deep.equal(['http://127.0.0.1:33418/callback']);
    expect(found).to.not.have.property('client_secret');
    expect(found?.grant_types).to.deep.equal(['authorization_code', 'refresh_token']);

    const row = await prisma.mcpClient.findUnique({ where: { id: info.client_id } });
    expect(JSON.parse(row!.redirectUris)).to.deep.equal(['http://127.0.0.1:33418/callback']);
  });

  it('names a client without a name', async () => {
    const info = await store.registerClient(registration({ client_name: '   ' }));
    expect(info.client_name).to.equal('Unnamed agent');
    expect(await store.nameOf(info.client_id)).to.equal('Unnamed agent');
  });

  it('registration rejects a redirect URI that is neither loopback, https nor a custom scheme', async () => {
    for (const uri of [
      'http://agent.example/callback',
      'http://192.168.1.10:8080/callback',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'https://agent.example/callback#frag',
      'https://user:pw@agent.example/callback',
      'not a url',
    ]) {
      const err = await oauthError(store.registerClient(registration({ redirect_uris: [uri] })));
      expect(err.errorCode, uri).to.equal('invalid_redirect_uri');
    }
    expect(await prisma.mcpClient.count()).to.equal(0);
  });

  it('accepts loopback, https and custom-scheme redirect URIs', async () => {
    for (const uri of [
      'http://127.0.0.1:4321/callback',
      'http://localhost/callback',
      'http://[::1]:9/cb',
      'https://agent.example/callback',
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'com.example.agent:/oauth',
    ]) {
      expect(redirectUriProblem(uri), uri).to.equal(null);
    }
    const info = await store.registerClient(
      registration({ redirect_uris: ['https://agent.example/cb', 'vscode://agent/cb'] }),
    );
    expect(info.redirect_uris).to.deep.equal(['https://agent.example/cb', 'vscode://agent/cb']);
  });

  it('refuses a registration without redirect URIs', async () => {
    const err = await oauthError(store.registerClient(registration({ redirect_uris: [] })));
    expect(err.errorCode).to.equal('invalid_redirect_uri');
  });

  it(`keeps at most ${MAX_REGISTERED_CLIENTS} clients, after dropping those unused for 30 days`, async () => {
    const now = Date.now();
    const rows = Array.from({ length: MAX_REGISTERED_CLIENTS }, (_, i) => ({
      id: `seeded-${i}`,
      name: 'seeded',
      redirectUris: '["http://127.0.0.1/cb"]',
      createdAt: new Date(now),
      lastUsedAt: new Date(now),
    }));
    await prisma.mcpClient.createMany({ data: rows });

    const err = await oauthError(store.registerClient(registration()));
    expect(err.errorCode).to.equal('too_many_requests');

    await prisma.mcpClient.update({
      where: { id: 'seeded-0' },
      data: { lastUsedAt: new Date(now - 31 * DAY) },
    });
    const info = await store.registerClient(registration());
    expect(info.client_id).to.be.a('string');
    expect(await prisma.mcpClient.findUnique({ where: { id: 'seeded-0' } })).to.equal(null);
    expect(await prisma.mcpClient.count()).to.equal(MAX_REGISTERED_CLIENTS);
  });

  it('forgets a client unused for 30 days, and keeps one in use', async () => {
    const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const used = await store.registerClient(registration());
    const idle = await store.registerClient(registration());
    clock.tick(20 * DAY);
    expect(await store.getClient(used.client_id)).to.not.equal(undefined);
    clock.tick(11 * DAY);
    expect(await store.getClient(used.client_id)).to.not.equal(undefined);
    expect(await store.getClient(idle.client_id)).to.equal(undefined);
    expect(await prisma.mcpClient.findUnique({ where: { id: idle.client_id } })).to.equal(null);
  });

  it('answers an unknown client with nothing', async () => {
    expect(await store.getClient('no-such-client')).to.equal(undefined);
  });

  describe('a client named by a metadata document', () => {
    const url = 'https://agent.example/oauth/client.json';

    it('is read from the document', async () => {
      const fetch = sinon.stub().resolves({
        client_id: url,
        client_name: 'Doc Agent',
        redirect_uris: ['http://127.0.0.1:5000/cb'],
      });
      store.fetchDocument = fetch;
      const client = await store.getClient(url);
      expect(fetch.calledOnceWith(url)).to.equal(true);
      expect(client?.client_id).to.equal(url);
      expect(client?.client_name).to.equal('Doc Agent');
      expect(client?.token_endpoint_auth_method).to.equal('none');
      expect(client).to.not.have.property('client_secret');
      expect(await store.nameOf(url)).to.equal('Doc Agent');
      expect(await prisma.mcpClient.count()).to.equal(0);
    });

    it('is refused as invalid_client when the document is refused', async () => {
      store.fetchDocument = sinon
        .stub()
        .rejects(new ClientMetadataRefused('private_address', 'it resolves to a private address'));
      const err = await oauthError(store.getClient(url) as Promise<unknown>);
      expect(err).to.be.instanceOf(InvalidClientError);
      expect(err.message).to.contain('private address');
    });

    it('is refused when the document names a redirect URI the hub does not allow', async () => {
      store.fetchDocument = sinon.stub().resolves({
        client_id: url,
        redirect_uris: ['http://agent.example/cb'],
      });
      const err = await oauthError(store.getClient(url) as Promise<unknown>);
      expect(err).to.be.instanceOf(InvalidClientError);
    });

    it('is refused when the document says the client has a secret', async () => {
      store.fetchDocument = sinon.stub().resolves({
        client_id: url,
        redirect_uris: ['http://127.0.0.1/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
      });
      const err = await oauthError(store.getClient(url) as Promise<unknown>);
      expect(err).to.be.instanceOf(InvalidClientError);
    });

    it('takes a plain http client_id as a document, and refuses it', async () => {
      const err = await oauthError(
        store.getClient('http://agent.example/client.json') as Promise<unknown>,
      );
      expect(err).to.be.instanceOf(InvalidClientError);
    });
  });
});
