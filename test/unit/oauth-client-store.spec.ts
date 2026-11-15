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
  REGISTRATIONS_PER_ADDRESS_PER_HOUR,
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

  async function seedFullStore(lastUsedAt: (i: number) => Date) {
    const rows = Array.from({ length: MAX_REGISTERED_CLIENTS }, (_, i) => ({
      id: `seeded-${i}`,
      name: 'seeded',
      redirectUris: '["http://127.0.0.1/cb"]',
      createdAt: lastUsedAt(i),
      lastUsedAt: lastUsedAt(i),
    }));
    await prisma.mcpClient.createMany({ data: rows });
  }

  it(`keeps at most ${MAX_REGISTERED_CLIENTS} clients, dropping those unused for 30 days first`, async () => {
    const now = Date.now();
    await seedFullStore((i) => new Date(now - (i === 7 ? 31 * DAY : 1000)));
    const info = await store.registerClient(registration(), '198.51.100.1');
    expect(info.client_id).to.be.a('string');
    expect(await prisma.mcpClient.findUnique({ where: { id: 'seeded-7' } })).to.equal(null);
    expect(await prisma.mcpClient.count()).to.equal(MAX_REGISTERED_CLIENTS);
  });

  it('a full store evicts the longest-unused client without a live sign-in, rather than refusing', async () => {
    const now = Date.now();
    // seeded-0 is the oldest, but signed in; seeded-1 is the oldest without a sign-in.
    await seedFullStore((i) => new Date(now - (MAX_REGISTERED_CLIENTS - i) * 60_000));
    await prisma.mcpGrant.deleteMany({});
    await prisma.mcpGrant.create({
      data: {
        id: 'grant-of-seeded-0',
        userId: 'someone',
        clientId: 'seeded-0',
        scopes: 'xenon:devices:read',
        tokenHash: 'x',
        createdAt: new Date(now),
        lastUsedAt: new Date(now),
        expiresAt: new Date(now + 90 * DAY),
      },
    });
    const info = await store.registerClient(registration(), '198.51.100.1');
    expect(info.client_id).to.be.a('string');
    expect(await prisma.mcpClient.findUnique({ where: { id: 'seeded-0' } })).to.not.equal(null);
    expect(await prisma.mcpClient.findUnique({ where: { id: 'seeded-1' } })).to.equal(null);
    expect(await prisma.mcpClient.count()).to.equal(MAX_REGISTERED_CLIENTS);
    await prisma.mcpGrant.deleteMany({});
  });

  it('refuses only when every registered client has a live sign-in', async () => {
    const now = Date.now();
    await seedFullStore(() => new Date(now));
    await prisma.mcpGrant.deleteMany({});
    await prisma.mcpGrant.createMany({
      data: Array.from({ length: MAX_REGISTERED_CLIENTS }, (_, i) => ({
        id: `grant-${i}`,
        userId: 'someone',
        clientId: `seeded-${i}`,
        scopes: 'xenon:devices:read',
        tokenHash: `h${i}`,
        createdAt: new Date(now),
        lastUsedAt: new Date(now),
        expiresAt: new Date(now + 90 * DAY),
      })),
    });
    const err = await oauthError(store.registerClient(registration(), '198.51.100.1'));
    expect(err.errorCode).to.equal('too_many_requests');
    await prisma.mcpGrant.deleteMany({});
  });

  /** Live sign-ins for the seeded clients `from` to `to` (exclusive). */
  async function signInSeeded(from: number, to: number, now: number) {
    await prisma.mcpGrant.createMany({
      data: Array.from({ length: to - from }, (_, k) => ({
        id: `grant-${from + k}`,
        userId: 'someone',
        clientId: `seeded-${from + k}`,
        scopes: 'xenon:devices:read',
        tokenHash: `h${from + k}`,
        createdAt: new Date(now),
        lastUsedAt: new Date(now),
        expiresAt: new Date(now + 90 * DAY),
      })),
    });
  }

  it('never evicts a client registered in the last 10 minutes: its sign-in may not have finished', async () => {
    const now = Date.now();
    const last = MAX_REGISTERED_CLIENTS - 1;
    // Every client is signed in but the newest, which registered 5 minutes
    // ago and whose user hasn't allowed it yet.
    await seedFullStore((i) => new Date(now - (i === last ? 5 : 60 * 24) * 60_000));
    await prisma.mcpGrant.deleteMany({});
    await signInSeeded(0, last, now);
    const err = await oauthError(store.registerClient(registration(), '198.51.100.1'));
    expect(err.errorCode).to.equal('too_many_requests');
    expect(err.message).to.equal(
      `This hub already has ${MAX_REGISTERED_CLIENTS} registered agents, each signed in or ` +
        'registered in the last 10 minutes. Try again later.',
    );
    expect(await prisma.mcpClient.findUnique({ where: { id: `seeded-${last}` } })).to.not.equal(
      null,
    );

    // Eleven minutes on it may go, as the longest-unused client without a sign-in.
    const clock = sinon.useFakeTimers({ now: now + 6 * 60_000, toFake: ['Date'] });
    const info = await store.registerClient(registration(), '198.51.100.2');
    clock.restore();
    expect(info.client_id).to.be.a('string');
    expect(await prisma.mcpClient.findUnique({ where: { id: `seeded-${last}` } })).to.equal(null);
    await prisma.mcpGrant.deleteMany({});
  });

  it('forgets a client unused for 30 days, and keeps one in use', async () => {
    const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const used = await store.registerClient(registration());
    const idle = await store.registerClient(registration());
    clock.tick(20 * DAY);
    await store.noteUsed(used.client_id);
    clock.tick(11 * DAY);
    expect(await store.getClient(used.client_id)).to.not.equal(undefined);
    expect(await store.getClient(idle.client_id)).to.equal(undefined);
    expect(await prisma.mcpClient.findUnique({ where: { id: idle.client_id } })).to.equal(null);
  });

  it("looking a client up doesn't count as using it", async () => {
    const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const info = await store.registerClient(registration());
    for (let day = 0; day < 31; day += 1) {
      clock.tick(DAY);
      await store.getClient(info.client_id);
    }
    expect(await store.getClient(info.client_id)).to.equal(undefined);
    expect(await prisma.mcpClient.findUnique({ where: { id: info.client_id } })).to.equal(null);
  });

  describe('registrations from one address', () => {
    it('refuses the 21st within an hour, and takes others', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      for (let i = 0; i < REGISTRATIONS_PER_ADDRESS_PER_HOUR; i += 1) {
        await store.registerClient(registration(), '203.0.113.9');
      }
      const err = await oauthError(store.registerClient(registration(), '203.0.113.9'));
      expect(err.errorCode).to.equal('too_many_requests');
      expect(await prisma.mcpClient.count()).to.equal(REGISTRATIONS_PER_ADDRESS_PER_HOUR);

      // Another address is counted on its own.
      await store.registerClient(registration(), '203.0.113.10');
      // An hour after the first, there is room again.
      clock.tick(60 * 60_000 + 1);
      await store.registerClient(registration(), '203.0.113.9');
    });

    it('counts registrations made, not refused ones', async () => {
      for (let i = 0; i < 30; i += 1) {
        await oauthError(
          store.registerClient(
            registration({ redirect_uris: ['http://evil.example/cb'] }),
            '203.0.113.9',
          ),
        );
      }
      await store.registerClient(registration(), '203.0.113.9');
    });

    it('counts registrations with no address together', async () => {
      for (let i = 0; i < REGISTRATIONS_PER_ADDRESS_PER_HOUR; i += 1) {
        await store.registerClient(registration());
      }
      const err = await oauthError(store.registerClient(registration()));
      expect(err.errorCode).to.equal('too_many_requests');
    });

    it('forAddress gives the SDK handler a store that counts that address', async () => {
      const view = store.forAddress('203.0.113.9');
      for (let i = 0; i < REGISTRATIONS_PER_ADDRESS_PER_HOUR; i += 1) {
        await view.registerClient!(registration());
      }
      const err = await oauthError(Promise.resolve(view.registerClient!(registration())));
      expect(err.errorCode).to.equal('too_many_requests');
      const info = await store.registerClient(registration(), '203.0.113.10');
      expect((await view.getClient(info.client_id))?.client_id).to.equal(info.client_id);
    });
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

    describe('with XENON_MCP_CLIENT_DOCUMENTS=off', () => {
      let saved: string | undefined;
      beforeEach(() => {
        saved = process.env.XENON_MCP_CLIENT_DOCUMENTS;
        process.env.XENON_MCP_CLIENT_DOCUMENTS = 'off';
      });
      afterEach(() => {
        if (saved === undefined) delete process.env.XENON_MCP_CLIENT_DOCUMENTS;
        else process.env.XENON_MCP_CLIENT_DOCUMENTS = saved;
      });

      it('is refused as invalid_client without fetching the document', async () => {
        const fetch = sinon.stub().resolves({
          client_id: url,
          client_name: 'Doc Agent',
          redirect_uris: ['http://127.0.0.1:5000/cb'],
        });
        store.fetchDocument = fetch;
        const err = await oauthError(store.getClient(url) as Promise<unknown>);
        expect(err).to.be.instanceOf(InvalidClientError);
        expect(err.message).to.equal(
          "This hub doesn't read client_id documents. Register the agent with the hub instead.",
        );
        // Named by its URL's host, still without a fetch.
        expect(await store.nameOf(url)).to.equal('agent.example');
        expect(fetch.called).to.equal(false);
      });

      it('still registers agents', async () => {
        const info = await store.registerClient(registration());
        expect((await store.getClient(info.client_id))?.client_name).to.equal('Claude Code');
      });

      it('takes any other value as on', async () => {
        process.env.XENON_MCP_CLIENT_DOCUMENTS = 'on';
        store.fetchDocument = sinon.stub().resolves({
          client_id: url,
          redirect_uris: ['http://127.0.0.1:5000/cb'],
        });
        expect((await store.getClient(url))?.client_id).to.equal(url);
      });
    });

    it('is refused as invalid_client when the document is refused', async () => {
      store.fetchDocument = sinon
        .stub()
        .rejects(new ClientMetadataRefused('private_address', 'it resolves to a private address'));
      const err = await oauthError(store.getClient(url) as Promise<unknown>);
      expect(err).to.be.instanceOf(InvalidClientError);
      expect(err.message).to.equal('The client_id document could not be fetched');
    });

    it("answers a name that doesn't resolve exactly as one that resolves privately", async () => {
      const answers: string[] = [];
      for (const reason of ['unresolvable', 'private_address', 'unreachable', 'timeout'] as const) {
        store.fetchDocument = sinon
          .stub()
          .rejects(new ClientMetadataRefused(reason, `detail ${reason}`));
        const err = await oauthError(store.getClient(url) as Promise<unknown>);
        expect(err.message).to.not.contain('detail');
        answers.push(JSON.stringify(err.toResponseObject()));
      }
      expect(new Set(answers).size).to.equal(1);
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

    it('refuses a client_id with control characters, and logs it escaped', async () => {
      const info = sinon.spy((store as any).log, 'info');
      for (const bad of [
        `${url}\r\nforged log line`,
        `${url}\tx`,
        'https://Agent.example/oauth/client.json',
      ]) {
        const err = await oauthError(store.getClient(bad) as Promise<unknown>);
        expect(err).to.be.instanceOf(InvalidClientError);
        expect(JSON.stringify(err.toResponseObject())).to.not.contain('forged');
      }
      for (const call of info.getCalls()) {
        expect(String(call.args[0])).to.not.match(/[\r\n\t]/);
      }
    });

    it('takes a plain http client_id as a document, and refuses it', async () => {
      const err = await oauthError(
        store.getClient('http://agent.example/client.json') as Promise<unknown>,
      );
      expect(err).to.be.instanceOf(InvalidClientError);
    });
  });
});
