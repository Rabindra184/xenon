import { expect } from 'chai';
import { MitmProxyHost } from '../../../src/services/interceptor/MitmProxyHost';
import { MockEngine } from '../../../src/services/interceptor/MockEngine';
import { CapturedRequest } from '../../../src/services/interceptor/types';

function makeHost(): { host: MitmProxyHost; emitted: CapturedRequest[] } {
  const emitted: CapturedRequest[] = [];
  const host = new MitmProxyHost(
    {
      port: 0,
      host: '0.0.0.0',
      sslCaDir: '/tmp/never-used',
      sessionId: 'sess-1',
      captureBodies: true,
    },
    new MockEngine(),
    (entry) => emitted.push(entry),
  );
  return { host, emitted };
}

describe('MitmProxyHost.classifyError', () => {
  it('classifies HTTPS_CLIENT_ERROR as a TLS-rejection failure', () => {
    const reason = MitmProxyHost.classifyError(new Error('alert bad cert'), 'HTTPS_CLIENT_ERROR');
    expect(reason).to.match(/HTTPS handshake rejected/);
    expect(reason).to.match(/cert is not trusted/i);
  });

  it('classifies OPEN_HTTPS_SERVER_ERROR', () => {
    expect(MitmProxyHost.classifyError(null, 'OPEN_HTTPS_SERVER_ERROR')).to.match(/HTTPS endpoint/);
  });

  it('classifies upstream PROXY_TO_SERVER_REQUEST_ERROR with code-aware reasons', () => {
    expect(
      MitmProxyHost.classifyError({ code: 'ENOTFOUND' }, 'PROXY_TO_SERVER_REQUEST_ERROR'),
    ).to.match(/DNS lookup failed/);
    expect(
      MitmProxyHost.classifyError({ code: 'ECONNREFUSED' }, 'PROXY_TO_SERVER_REQUEST_ERROR'),
    ).to.match(/refused/);
    expect(
      MitmProxyHost.classifyError({ code: 'ETIMEDOUT' }, 'PROXY_TO_SERVER_REQUEST_ERROR'),
    ).to.match(/timed out/);
    expect(
      MitmProxyHost.classifyError({ code: 'EHOSTUNREACH' }, 'PROXY_TO_SERVER_REQUEST_ERROR'),
    ).to.match(/EHOSTUNREACH/);
  });

  it('returns null for kinds we do not surface to users', () => {
    expect(MitmProxyHost.classifyError(null, 'CLIENT_TO_PROXY_REQUEST_ERROR')).to.equal(null);
    expect(MitmProxyHost.classifyError(null, 'ON_RESPONSE_DATA_ERROR')).to.equal(null);
    expect(MitmProxyHost.classifyError(null, 'UNKNOWN')).to.equal(null);
  });
});

describe('MitmProxyHost.handleProxyError', () => {
  it('emits a stub capture with failed=true for ctx-bearing errors', () => {
    const { host, emitted } = makeHost();
    const ctx = { clientToProxyRequest: { headers: { host: 'api.example.com' } } };
    host.handleProxyError(ctx, { code: 'ENOTFOUND' }, 'PROXY_TO_SERVER_REQUEST_ERROR');

    expect(emitted).to.have.length(1);
    const entry = emitted[0];
    expect(entry.failed).to.equal(true);
    expect(entry.host).to.equal('api.example.com');
    expect(entry.url).to.equal('https://api.example.com');
    expect(entry.method).to.equal('CONNECT');
    expect(entry.resStatus).to.equal(-1);
    expect(entry.failureKind).to.equal('PROXY_TO_SERVER_REQUEST_ERROR');
    expect(entry.failureReason).to.match(/DNS lookup failed/);
  });

  it('falls back to most-recent CONNECT when ctx is null', () => {
    const { host, emitted } = makeHost();
    (host as any).recentConnects.push({ host: 'first.example.com', ts: Date.now() - 1000 });
    (host as any).recentConnects.push({ host: 'second.example.com', ts: Date.now() });

    host.handleProxyError(null, new Error('alert bad cert'), 'HTTPS_CLIENT_ERROR');

    expect(emitted).to.have.length(1);
    expect(emitted[0].host).to.equal('second.example.com');
    expect(emitted[0].failureKind).to.equal('HTTPS_CLIENT_ERROR');
  });

  it('dedupes repeated failures for the same (host, errorKind)', () => {
    const { host, emitted } = makeHost();
    const ctx = { clientToProxyRequest: { headers: { host: 'api.example.com' } } };

    host.handleProxyError(ctx, new Error('x'), 'HTTPS_CLIENT_ERROR');
    host.handleProxyError(ctx, new Error('x'), 'HTTPS_CLIENT_ERROR');
    host.handleProxyError(ctx, new Error('x'), 'HTTPS_CLIENT_ERROR');

    expect(emitted).to.have.length(1);
  });

  it('emits separately for the same host under a different errorKind', () => {
    const { host, emitted } = makeHost();
    const ctx = { clientToProxyRequest: { headers: { host: 'api.example.com' } } };

    host.handleProxyError(ctx, new Error('x'), 'HTTPS_CLIENT_ERROR');
    host.handleProxyError(ctx, { code: 'ENOTFOUND' }, 'PROXY_TO_SERVER_REQUEST_ERROR');

    expect(emitted).to.have.length(2);
    expect(emitted.map((e) => e.failureKind)).to.deep.equal([
      'HTTPS_CLIENT_ERROR',
      'PROXY_TO_SERVER_REQUEST_ERROR',
    ]);
  });

  it('drops the error when host cannot be attributed', () => {
    const { host, emitted } = makeHost();
    // No recentConnects, ctx is null → can't attribute.
    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    expect(emitted).to.have.length(0);
  });

  it('ignores stale CONNECTs older than the TTL window', () => {
    const { host, emitted } = makeHost();
    (host as any).recentConnects.push({ host: 'stale.example.com', ts: Date.now() - 60_000 });

    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    expect(emitted).to.have.length(0);
  });

  it('strips port from host:port in the Host header', () => {
    const { host, emitted } = makeHost();
    const ctx = { clientToProxyRequest: { headers: { host: 'api.example.com:8443' } } };
    host.handleProxyError(ctx, new Error('x'), 'HTTPS_CLIENT_ERROR');
    expect(emitted[0].host).to.equal('api.example.com');
  });

  it('does not emit for unclassified error kinds', () => {
    const { host, emitted } = makeHost();
    const ctx = { clientToProxyRequest: { headers: { host: 'api.example.com' } } };
    host.handleProxyError(ctx, new Error('x'), 'CLIENT_TO_PROXY_REQUEST_ERROR');
    expect(emitted).to.have.length(0);
  });
});
