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
