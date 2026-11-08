import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { InternalHttpClient } from '../../src/InternalHttpClient';
import { PortAllocatorClient } from '../../src/services/ports/PortAllocatorClient';

// A grant pass reserves ports while it holds the allocation lock, so its
// reservation is sent once, with a short timeout: InternalHttpClient's default
// retries (four 30 s tries) to a dead node would hold every allocation up.

describe('PortAllocatorClient.allocate', () => {
  let post: sinon.SinonStub;

  beforeEach(() => {
    post = sinon.stub(InternalHttpClient, 'post').resolves({ ports: { systemPort: 8201 } });
  });

  afterEach(() => sinon.restore());

  const allocate = (extra: Record<string, unknown> = {}) =>
    new PortAllocatorClient().allocate({
      nodeHost: 'http://node.test:4723',
      udid: 'u1',
      purposes: ['systemPort'],
      durationMs: 60_000,
      leaseId: 'lse_1',
      nodePairAuth: { accessKey: 'k', token: 't' },
      ...extra,
    });

  it('with once, sends the request once with a 10 s timeout', async () => {
    expect(await allocate({ once: true })).to.deep.equal({ systemPort: 8201 });

    const [url, body, config] = post.firstCall.args;
    expect(url).to.equal('http://node.test:4723/xenon/api/ports/allocate');
    expect(body).to.not.have.property('once');
    expect(config).to.deep.include({ retry: false, timeout: 10_000 });
    expect(config.headers).to.deep.equal({ 'x-xenon-access-key': 'k', 'x-xenon-token': 't' });
  });

  it("without once, keeps the client's own retries and timeout", async () => {
    await allocate();

    const config = post.firstCall.args[2];
    expect(config).to.not.have.property('retry');
    expect(config).to.not.have.property('timeout');
  });
});

// This server's own phone is reserved in its own database, in process: no
// HTTP to itself, and so no node credentials (ownPorts.ts).
describe("PortAllocatorClient and this server's own phones", () => {
  let post: sinon.SinonStub;
  let allocator: { allocate: sinon.SinonStub; extend: sinon.SinonStub; release: sinon.SinonStub };
  let client: PortAllocatorClient;
  const OWN = 'http://127.0.0.1:4723';
  const auth = { accessKey: '', token: '' };

  beforeEach(() => {
    post = sinon.stub(InternalHttpClient, 'post').rejects(new Error('no HTTP'));
    allocator = {
      allocate: sinon.stub().resolves({ systemPort: 13100 }),
      extend: sinon.stub().resolves({ extended: 1 }),
      release: sinon.stub().resolves({ released: 1 }),
    };
    client = new PortAllocatorClient();
    client.ownPorts = { isOwnHost: (host) => host === OWN, allocator: () => allocator as any };
  });

  afterEach(() => sinon.restore());

  it('allocates, extends and releases an own phone in process', async () => {
    expect(
      await client.allocate({
        nodeHost: OWN,
        udid: 'u1',
        purposes: ['systemPort'],
        durationMs: 60_000,
        leaseId: 'lse_1',
        nodePairAuth: auth,
      }),
    ).to.deep.equal({ systemPort: 13100 });
    expect(allocator.allocate.firstCall.args[0]).to.deep.equal({
      udid: 'u1',
      host: OWN,
      purposes: ['systemPort'],
      durationMs: 60_000,
      leaseId: 'lse_1',
    });
    await client.extend({
      nodeHost: OWN,
      udid: 'u1',
      ports: [13100],
      expiresAt: 5,
      nodePairAuth: auth,
    });
    expect(allocator.extend.firstCall.args[0]).to.deep.equal({
      udid: 'u1',
      ports: [13100],
      expiresAt: 5,
    });
    await client.release({ nodeHost: OWN, udid: 'u1', ports: [13100], nodePairAuth: auth });
    expect(allocator.release.firstCall.args[0]).to.deep.equal({ udid: 'u1', ports: [13100] });
    expect(post.called).to.equal(false);
  });

  it("sends another server's phone over HTTP", async () => {
    post.resolves({ ports: { systemPort: 8201 } });

    await client.allocate({
      nodeHost: 'http://node.test:4723',
      udid: 'u1',
      purposes: ['systemPort'],
      durationMs: 60_000,
      nodePairAuth: { accessKey: 'k', token: 't' },
    });

    expect(post.firstCall.args[0]).to.equal('http://node.test:4723/xenon/api/ports/allocate');
    expect(allocator.allocate.called).to.equal(false);
  });
});
