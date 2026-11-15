import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import https from 'https';
import forge from 'node-forge';
import { PassThrough } from 'stream';
import type { AddressInfo } from 'net';
import {
  CLIENT_DOCUMENT_FALLBACK_MS,
  ClientMetadataRefused,
  MetadataFetchDeps,
  MetadataResponse,
  ResolvedAddress,
  clearClientMetadataCache,
  clientDocumentsAccepted,
  clientDocumentsOffered,
  fetchClientMetadataDocument,
  isPublicAddress,
  noteUnreachableClientDocument,
  openPinned,
  resetClientDocumentFallback,
} from '../../src/services/oauth/clientMetadataDocument';

const DOC_URL = 'https://agent.example/oauth/client.json';
const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };

function documentFor(url = DOC_URL, extra: Record<string, unknown> = {}) {
  return {
    client_id: url,
    client_name: 'Example Agent',
    redirect_uris: ['http://127.0.0.1:33418/callback'],
    token_endpoint_auth_method: 'none',
    ...extra,
  };
}

/** A response the fake transport hands back: a status, headers and a body stream. */
function response(
  status: number,
  body: string | Buffer = '',
  headers: Record<string, string> = {},
): MetadataResponse {
  const stream = new PassThrough();
  stream.end(typeof body === 'string' ? Buffer.from(body) : body);
  return { status, headers, body: stream };
}

/**
 * Stand-ins for DNS and the connection, so no spec reaches the network. The
 * status, redirect, size and JSON checks stay in the code under test: only
 * the name lookup and the socket are replaced.
 */
function fakes(
  addresses: ResolvedAddress[],
  answer: () => MetadataResponse | Promise<MetadataResponse>,
) {
  const resolve = sinon.stub().resolves(addresses);
  const open = sinon.stub().callsFake(async () => answer());
  const deps: MetadataFetchDeps = { resolve, open };
  return { deps, resolve, open };
}

async function refusal(promise: Promise<unknown>): Promise<ClientMetadataRefused> {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(ClientMetadataRefused);
    return err as ClientMetadataRefused;
  }
  throw new Error('expected the document to be refused');
}

/** A self-signed certificate for `host`, so a local TLS server can stand for it. */
function certificateFor(host: string): { key: string; cert: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 3_600_000);
  const attrs = [{ name: 'commonName', value: host }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: host }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

/**
 * A client ID metadata document: an agent whose client_id is an https URL.
 * The hub fetches it, so the fetch must never be a way to reach the hub's own
 * network (Review Focus 2).
 */
describe('client metadata documents', () => {
  beforeEach(() => clearClientMetadataCache());
  afterEach(() => {
    sinon.restore();
    clearClientMetadataCache();
  });

  it('accepts a valid https document', async () => {
    const { deps, resolve, open } = fakes([PUBLIC], () =>
      response(200, JSON.stringify(documentFor()), { 'content-type': 'application/json' }),
    );
    const meta = await fetchClientMetadataDocument(DOC_URL, deps);
    expect(meta.client_id).to.equal(DOC_URL);
    expect(meta.client_name).to.equal('Example Agent');
    expect(meta.redirect_uris).to.deep.equal(['http://127.0.0.1:33418/callback']);
    expect(resolve.calledOnceWith('agent.example')).to.equal(true);
    const [url, target] = open.firstCall.args;
    expect(String(url)).to.equal(DOC_URL);
    expect(target).to.deep.equal(PUBLIC);
  });

  it('keeps a document for 10 minutes', async () => {
    const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const { deps, open } = fakes([PUBLIC], () => response(200, JSON.stringify(documentFor())));
    await fetchClientMetadataDocument(DOC_URL, deps);
    clock.tick(9 * 60_000);
    await fetchClientMetadataDocument(DOC_URL, deps);
    expect(open.callCount).to.equal(1);
    clock.tick(2 * 60_000);
    await fetchClientMetadataDocument(DOC_URL, deps);
    expect(open.callCount).to.equal(2);
  });

  it('refuses a plain http: URL without looking it up', async () => {
    const { deps, resolve, open } = fakes([PUBLIC], () =>
      response(200, JSON.stringify(documentFor())),
    );
    const err = await refusal(
      fetchClientMetadataDocument('http://agent.example/client.json', deps),
    );
    expect(err.reason).to.equal('not_https');
    expect(resolve.called).to.equal(false);
    expect(open.called).to.equal(false);
  });

  it('refuses a redirect', async () => {
    const { deps } = fakes([PUBLIC], () =>
      response(302, '', { location: 'https://127.0.0.1/client.json' }),
    );
    const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
    expect(err.reason).to.equal('redirect');
  });

  it('refuses any answer but 200', async () => {
    const { deps } = fakes([PUBLIC], () => response(404, 'nope'));
    const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
    expect(err.reason).to.equal('status');
  });

  it('refuses a 65 KB document sent without a length', async () => {
    const big = JSON.stringify(documentFor(DOC_URL, { padding: 'x'.repeat(65 * 1024) }));
    const { deps } = fakes([PUBLIC], () => response(200, big));
    const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
    expect(err.reason).to.equal('too_large');
  });

  it('refuses a document whose length says 65 KB before reading it', async () => {
    const { deps } = fakes([PUBLIC], () =>
      response(200, JSON.stringify(documentFor()), { 'content-length': String(65 * 1024) }),
    );
    const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
    expect(err.reason).to.equal('too_large');
  });

  for (const [address, family] of [
    ['127.0.0.1', 4],
    ['10.0.0.5', 4],
    ['169.254.1.1', 4],
    ['fd00::1', 6],
  ] as const) {
    it(`refuses a host resolving to ${address}, without connecting`, async () => {
      const { deps, open } = fakes([{ address, family }], () =>
        response(200, JSON.stringify(documentFor())),
      );
      const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
      expect(err.reason).to.equal('private_address');
      expect(open.called).to.equal(false);
    });
  }

  it('refuses a host with one private address among public ones', async () => {
    const { deps, open } = fakes([PUBLIC, { address: '192.168.1.20', family: 4 }], () =>
      response(200, JSON.stringify(documentFor())),
    );
    const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
    expect(err.reason).to.equal('private_address');
    expect(open.called).to.equal(false);
  });

  for (const url of [
    'https://127.0.0.1/client.json',
    'https://[::1]/client.json',
    'https://[::ffff:a00:1]/client.json', // ::ffff:10.0.0.1, as the parser writes it
    'https://0.0.0.0/client.json',
  ]) {
    it(`refuses the address literal in ${url} without a lookup`, async () => {
      const { deps, resolve, open } = fakes([PUBLIC], () =>
        response(200, JSON.stringify(documentFor(url))),
      );
      const err = await refusal(fetchClientMetadataDocument(url, deps));
      expect(err.reason).to.equal('private_address');
      expect(resolve.called).to.equal(false);
      expect(open.called).to.equal(false);
    });
  }

  it('refuses a host that resolves to nothing', async () => {
    const { deps } = fakes([], () => response(200, JSON.stringify(documentFor())));
    const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
    expect(err.reason).to.equal('unresolvable');
  });

  it('refuses a URL with credentials, a fragment, no path, control characters or another spelling', async () => {
    const { deps } = fakes([PUBLIC], () => response(200, JSON.stringify(documentFor())));
    for (const url of [
      'https://user:pass@agent.example/client.json',
      'https://agent.example/client.json#x',
      'https://agent.example/',
      'https://agent.example/client.json\r\nforged',
      'https://agent.example/client\t.json',
      'https://Agent.example/client.json',
      'https://agent.example:443/client.json',
    ]) {
      const err = await refusal(fetchClientMetadataDocument(url, deps));
      expect(err.reason, url).to.equal('bad_url');
    }
  });

  it('refuses a document that names another client_id', async () => {
    const { deps } = fakes([PUBLIC], () =>
      response(200, JSON.stringify(documentFor('https://other.example/client.json'))),
    );
    const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
    expect(err.reason).to.equal('client_id_mismatch');
  });

  it('refuses a body that is not a client metadata document', async () => {
    for (const body of ['not json', JSON.stringify({ client_id: DOC_URL })]) {
      const { deps } = fakes([PUBLIC], () => response(200, body));
      const err = await refusal(fetchClientMetadataDocument(DOC_URL, deps));
      expect(err.reason).to.equal('invalid_document');
    }
  });

  it('gives up after 5 s', async () => {
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { deps } = fakes([PUBLIC], () => new Promise<MetadataResponse>(() => undefined));
    const pending = refusal(fetchClientMetadataDocument(DOC_URL, deps));
    await clock.tickAsync(5_001);
    const err = await pending;
    expect(err.reason).to.equal('timeout');
  });

  it('gives up after 5 s when the lookup never answers', async () => {
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const deps: MetadataFetchDeps = {
      resolve: () => new Promise<ResolvedAddress[]>(() => undefined),
      open: sinon.stub(),
    };
    const pending = refusal(fetchClientMetadataDocument(DOC_URL, deps));
    await clock.tickAsync(5_001);
    expect((await pending).reason).to.equal('timeout');
  });

  it('classifies addresses', () => {
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '64:ff9b::808:808']) {
      expect(isPublicAddress(a), a).to.equal(true);
    }
    for (const a of [
      '127.0.0.1',
      '127.8.9.1',
      '10.0.0.5',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '255.255.255.255',
      '224.0.0.1',
      '::',
      '::1',
      'fd00::1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
      '2002:a00:1::1',
      '::ffff:0:127.0.0.1',
      '::ffff:0:808:808',
      'not an address',
    ]) {
      expect(isPublicAddress(a), a).to.equal(false);
    }
  });

  /**
   * The real transport connects to the address that was checked, never a
   * second lookup of the name (which a DNS rebinding answer could change),
   * and still checks the certificate against the host's name.
   */
  describe('the transport', () => {
    let server: https.Server | undefined;
    afterEach(async () => {
      if (server) await new Promise((r) => server!.close(r));
      server = undefined;
    });

    it('connects to the checked address and verifies the host name', async function () {
      this.timeout(20_000);
      const { key, cert } = certificateFor('doc.invalid');
      let served = '';
      server = https.createServer({ key, cert }, (req, res) => {
        served = `${req.headers.host} ${req.url}`;
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
      });
      await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
      const { port } = server.address() as AddressInfo;
      const url = new URL(`https://doc.invalid:${port}/client.json`);
      const answer = await openPinned(
        url,
        { address: '127.0.0.1', family: 4 },
        new AbortController().signal,
        { ca: cert },
      );
      expect(answer.status).to.equal(200);
      const chunks: Buffer[] = [];
      for await (const chunk of answer.body) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString()).to.equal('{"ok":true}');
      expect(served).to.equal(`doc.invalid:${port} /client.json`);

      // The same server under another name fails the certificate check.
      const other = new URL(`https://other.invalid:${port}/client.json`);
      let failed = false;
      try {
        await openPinned(other, { address: '127.0.0.1', family: 4 }, new AbortController().signal, {
          ca: cert,
        });
      } catch {
        failed = true;
      }
      expect(failed).to.equal(true);
    });
  });
});

/**
 * A hub on a network without internet access can't fetch an agent's
 * document. One network failure turns documents off for an hour, so the
 * agent's next sign-in registers with the hub instead.
 */
describe("falling back when documents can't be fetched", () => {
  const t = 1_000_000;
  const minutes = (n: number) => n * 60_000;
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.XENON_MCP_CLIENT_DOCUMENTS;
    delete process.env.XENON_MCP_CLIENT_DOCUMENTS;
  });
  afterEach(() => {
    resetClientDocumentFallback();
    if (saved === undefined) delete process.env.XENON_MCP_CLIENT_DOCUMENTS;
    else process.env.XENON_MCP_CLIENT_DOCUMENTS = saved;
  });

  it('is on until a network failure, then off for an hour', () => {
    expect(clientDocumentsOffered(t)).to.equal(true);
    expect(noteUnreachableClientDocument(t)).to.equal(true);
    expect(clientDocumentsOffered(t + 1)).to.equal(false);
    expect(clientDocumentsOffered(t + CLIENT_DOCUMENT_FALLBACK_MS - 1)).to.equal(false);
    expect(clientDocumentsOffered(t + CLIENT_DOCUMENT_FALLBACK_MS)).to.equal(true);
  });

  it('restarts the hour on each failure, and says only the first opened it', () => {
    expect(noteUnreachableClientDocument(t)).to.equal(true);
    expect(noteUnreachableClientDocument(t + minutes(30))).to.equal(false);
    expect(clientDocumentsOffered(t + minutes(61))).to.equal(false);
    expect(clientDocumentsOffered(t + minutes(30) + CLIENT_DOCUMENT_FALLBACK_MS)).to.equal(true);
  });

  it('opens a new window after the last one ran out', () => {
    expect(noteUnreachableClientDocument(t)).to.equal(true);
    expect(noteUnreachableClientDocument(t + CLIENT_DOCUMENT_FALLBACK_MS)).to.equal(true);
  });

  it('still reads documents for agents already named by one while it falls back', () => {
    noteUnreachableClientDocument(t);
    expect(clientDocumentsOffered(t + 1)).to.equal(false);
    expect(clientDocumentsAccepted()).to.equal(true);
  });

  it('stays off while XENON_MCP_CLIENT_DOCUMENTS=off, whatever the window', () => {
    process.env.XENON_MCP_CLIENT_DOCUMENTS = 'off';
    expect(clientDocumentsOffered(t)).to.equal(false);
    expect(clientDocumentsAccepted()).to.equal(false);
    noteUnreachableClientDocument(t);
    delete process.env.XENON_MCP_CLIENT_DOCUMENTS;
    expect(clientDocumentsOffered(t + 1)).to.equal(false);
    expect(clientDocumentsOffered(t + CLIENT_DOCUMENT_FALLBACK_MS)).to.equal(true);
  });
});
