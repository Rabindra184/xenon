import { expect } from 'chai';
import { MitmProxyHost } from '../../../src/services/interceptor/MitmProxyHost';
import { MockEngine } from '../../../src/services/interceptor/MockEngine';
import { CapturedRequest } from '../../../src/services/interceptor/types';

function makeHost(mockEngine: MockEngine = new MockEngine()): {
  host: MitmProxyHost;
  emitted: CapturedRequest[];
} {
  const emitted: CapturedRequest[] = [];
  const host = new MitmProxyHost(
    {
      port: 0,
      host: '0.0.0.0',
      sslCaDir: '/tmp/never-used',
      sessionId: 'sess-1',
      captureBodies: true,
    },
    mockEngine,
    (entry) => emitted.push(entry),
  );
  return { host, emitted };
}

interface FakeCtx {
  clientToProxyRequest: { headers: Record<string, any>; method: string; url: string };
  proxyToClientResponse: {
    written: Buffer[];
    ended: boolean;
    write(chunk: any): void;
    end(): void;
    writeHead(status: number, headers: Record<string, string>): void;
    headWritten?: { status: number; headers: Record<string, string> };
  };
  serverToProxyResponse: { statusCode: number; headers: Record<string, any> };
  proxyToServerRequest: { written: Buffer[]; write(chunk: any): void };
  proxyToServerRequestOptions: { headers: Record<string, any> };
  isSSL: boolean;
  tags?: Record<string, any>;
  onRequestDataHandlers: Array<(c: any, chunk: any, cb: any) => void>;
  onRequestEndHandlers: Array<(c: any, cb: any) => void>;
  onRequestData(fn: (c: any, chunk: any, cb: any) => void): void;
  onRequestEnd(fn: (c: any, cb: any) => void): void;
}

function fakeCtx(
  opts: {
    method?: string;
    url?: string;
    hostHeader?: string;
    isSSL?: boolean;
    reqHeaders?: Record<string, any>;
    resStatus?: number;
    resHeaders?: Record<string, any>;
  } = {},
): FakeCtx {
  const ctx: any = {
    clientToProxyRequest: {
      headers: { host: opts.hostHeader ?? 'api.example.com', ...(opts.reqHeaders || {}) },
      method: opts.method ?? 'GET',
      url: opts.url ?? '/users/1',
    },
    proxyToClientResponse: {
      written: [] as Buffer[],
      ended: false,
      write(chunk: any) {
        this.written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end() {
        this.ended = true;
      },
      writeHead(status: number, headers: Record<string, string>) {
        (this as any).headWritten = { status, headers };
      },
    },
    serverToProxyResponse: {
      statusCode: opts.resStatus ?? 200,
      headers: { 'content-type': 'application/json', ...(opts.resHeaders || {}) },
    },
    proxyToServerRequest: {
      written: [] as Buffer[],
      write(chunk: any) {
        this.written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
    },
    proxyToServerRequestOptions: { headers: {} as Record<string, any> },
    isSSL: opts.isSSL ?? true,
    onRequestDataHandlers: [] as Array<(c: any, chunk: any, cb: any) => void>,
    onRequestEndHandlers: [] as Array<(c: any, cb: any) => void>,
    onRequestData(fn: any) {
      this.onRequestDataHandlers.push(fn);
    },
    onRequestEnd(fn: any) {
      this.onRequestEndHandlers.push(fn);
    },
  };
  return ctx as FakeCtx;
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

  it('classifies HTTPS_SERVER_ERROR', () => {
    expect(MitmProxyHost.classifyError(null, 'HTTPS_SERVER_ERROR')).to.match(
      /server-side error during TLS/i,
    );
  });

  it('classifies ON_CONNECT_ERROR', () => {
    expect(MitmProxyHost.classifyError(null, 'ON_CONNECT_ERROR')).to.match(/CONNECT tunnel/);
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
    (host as any).recentConnects.push({
      host: 'first.example.com',
      ts: Date.now() - 1000,
      consumed: false,
    });
    (host as any).recentConnects.push({
      host: 'second.example.com',
      ts: Date.now(),
      consumed: false,
    });

    host.handleProxyError(null, new Error('alert bad cert'), 'HTTPS_CLIENT_ERROR');

    expect(emitted).to.have.length(1);
    expect(emitted[0].host).to.equal('second.example.com');
    expect(emitted[0].failureKind).to.equal('HTTPS_CLIENT_ERROR');
  });

  it('walks back to next-most-recent CONNECT when the newest is already consumed', () => {
    const { host, emitted } = makeHost();
    (host as any).recentConnects.push({
      host: 'auth.example.com',
      ts: Date.now() - 200,
      consumed: false,
    });
    (host as any).recentConnects.push({
      host: 'api.example.com',
      ts: Date.now() - 100,
      consumed: false,
    });
    (host as any).recentConnects.push({
      host: 'cdn.example.com',
      ts: Date.now(),
      consumed: false,
    });

    // Three concurrent CONNECTs, three ctx-less TLS rejections — without the consumed
    // flag all three would attribute to cdn and only the first would emit (dedupe).
    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');

    expect(emitted).to.have.length(3);
    expect(emitted.map((e) => e.host)).to.deep.equal([
      'cdn.example.com',
      'api.example.com',
      'auth.example.com',
    ]);
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
    (host as any).recentConnects.push({
      host: 'stale.example.com',
      ts: Date.now() - 60_000,
      consumed: false,
    });

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

describe('MitmProxyHost.recordConnect', () => {
  it('records the host portion of a CONNECT URL into the ring', () => {
    const { host } = makeHost();
    host.recordConnect('api.example.com:443');
    const ring = (host as any).recentConnects;
    expect(ring).to.have.length(1);
    expect(ring[0].host).to.equal('api.example.com');
    expect(ring[0].consumed).to.equal(false);
  });

  it('strips port from host:port', () => {
    const { host } = makeHost();
    host.recordConnect('cdn.example.com:8443');
    expect((host as any).recentConnects[0].host).to.equal('cdn.example.com');
  });

  it('ignores empty CONNECT URLs (no ring push)', () => {
    const { host } = makeHost();
    host.recordConnect('');
    host.recordConnect(undefined);
    host.recordConnect(null);
    expect((host as any).recentConnects).to.have.length(0);
  });

  // Tied to RECENT_CONNECT_RING in the source. If that constant changes, update here.
  it('caps the ring at 20 entries and evicts oldest on overflow', () => {
    const { host } = makeHost();
    for (let i = 0; i < 25; i++) host.recordConnect(`h${i}.example.com:443`);
    const ring = (host as any).recentConnects;
    expect(ring).to.have.length(20);
    // oldest five (h0..h4) should be gone; h5 is now the eldest, h24 the newest
    expect(ring[0].host).to.equal('h5.example.com');
    expect(ring[ring.length - 1].host).to.equal('h24.example.com');
  });
});

describe('MitmProxyHost.handleProxyError ring edge cases', () => {
  it('drops the error when every recent CONNECT is already consumed', () => {
    const { host, emitted } = makeHost();
    (host as any).recentConnects.push(
      { host: 'a.example.com', ts: Date.now(), consumed: true },
      { host: 'b.example.com', ts: Date.now(), consumed: true },
    );
    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    expect(emitted).to.have.length(0);
  });

  it('attributes ctx-bearing errors without consuming ring entries', () => {
    // Regression guard: ctx-bearing errors take their host from the request and must
    // not touch the ring — otherwise a normal failed lookup would silently consume a
    // slot meant for a parallel ctx-less attribution.
    const { host, emitted } = makeHost();
    (host as any).recentConnects.push({ host: 'tls.example.com', ts: Date.now(), consumed: false });

    host.handleProxyError(
      { clientToProxyRequest: { headers: { host: 'dns.example.com' } } },
      { code: 'ENOTFOUND' },
      'PROXY_TO_SERVER_REQUEST_ERROR',
    );

    expect(emitted).to.have.length(1);
    expect(emitted[0].host).to.equal('dns.example.com');
    expect((host as any).recentConnects[0].consumed).to.equal(false);

    // The ring entry should still be available for a subsequent ctx-less error.
    host.handleProxyError(null, new Error('handshake'), 'HTTPS_CLIENT_ERROR');
    expect(emitted).to.have.length(2);
    expect(emitted[1].host).to.equal('tls.example.com');
  });

  // Tied to RECENT_CONNECT_TTL_MS in the source. If that constant changes, update here.
  it('honors the TTL boundary: entry exactly at the cutoff is still attributed', () => {
    const { host, emitted } = makeHost();
    (host as any).recentConnects.push({
      host: 'edge.example.com',
      // strict `>` in the source means equal-to-TTL is still attributable
      ts: Date.now() - 30_000,
      consumed: false,
    });
    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    expect(emitted).to.have.length(1);
    expect(emitted[0].host).to.equal('edge.example.com');
  });

  it('honors the TTL boundary: entry one ms past the cutoff is skipped', () => {
    const { host, emitted } = makeHost();
    (host as any).recentConnects.push({
      host: 'stale.example.com',
      ts: Date.now() - 30_001,
      consumed: false,
    });
    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    expect(emitted).to.have.length(0);
  });

  it('attributes correctly even after ring overflow evicts older hosts', () => {
    const { host, emitted } = makeHost();
    // 25 distinct CONNECTs — first 5 evicted, last 20 retained
    for (let i = 0; i < 25; i++) host.recordConnect(`h${i}.example.com:443`);

    // 20 ctx-less errors of the same kind to distinct hosts: each consumes one
    // unconsumed entry from the ring, walking newest-to-oldest.
    for (let i = 0; i < 20; i++) {
      host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    }

    // We should attribute exactly 20 errors, all to retained hosts (h5..h24).
    expect(emitted).to.have.length(20);
    const attributed = new Set(emitted.map((e) => e.host));
    for (let i = 5; i < 25; i++) expect(attributed.has(`h${i}.example.com`)).to.equal(true);
    for (let i = 0; i < 5; i++) expect(attributed.has(`h${i}.example.com`)).to.equal(false);
  });

  it('intentionally collapses parallel same-(host, kind) ctx-less failures to one capture', () => {
    // Documenting current behavior as a UX choice, not a bug: when many concurrent
    // CONNECTs to the same host all fail the TLS handshake the same way, the network
    // panel shows ONE row, not N. If we ever change this (e.g. show a count), this
    // test should be updated together with the change.
    const { host, emitted } = makeHost();
    for (let i = 0; i < 5; i++) host.recordConnect('api.example.com:443');
    for (let i = 0; i < 5; i++) {
      host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    }
    expect(emitted).to.have.length(1);
    expect(emitted[0].host).to.equal('api.example.com');
    // All five ring entries get consumed even though only one capture is emitted.
    // That is wasteful but harmless; documenting the current shape, not endorsing it.
    const consumed = (host as any).recentConnects.filter((c: any) => c.consumed).length;
    expect(consumed).to.equal(5);
  });

  it('reports distinct kinds separately even when ring entries are exhausted', () => {
    const { host, emitted } = makeHost();
    (host as any).recentConnects.push({
      host: 'api.example.com',
      ts: Date.now(),
      consumed: false,
    });
    // First ctx-less error consumes the only entry and emits.
    host.handleProxyError(null, new Error('x'), 'HTTPS_CLIENT_ERROR');
    // Second ctx-less error of a different kind has no unconsumed entry to claim,
    // so it drops — even though logically the host is the same. Documenting that
    // distinct-kind attribution requires a fresh ring entry.
    host.handleProxyError(null, { code: 'ENOTFOUND' }, 'PROXY_TO_SERVER_REQUEST_ERROR');
    expect(emitted).to.have.length(1);
    expect(emitted[0].failureKind).to.equal('HTTPS_CLIENT_ERROR');
  });
});

describe('MitmProxyHost.applyResponseBodyTransform', () => {
  it('replaces with provided string body when bodyTransform is "replace"', () => {
    const out = MitmProxyHost.applyResponseBodyTransform(
      { bodyTransform: 'replace', body: 'hello' },
      '{"original":true}',
    );
    expect(out).to.equal('hello');
  });

  it('JSON-stringifies object body for "replace"', () => {
    const out = MitmProxyHost.applyResponseBodyTransform(
      { bodyTransform: 'replace', body: { ok: true } },
      '{"original":true}',
    );
    expect(JSON.parse(out)).to.deep.equal({ ok: true });
  });

  it('merges patch object onto original JSON for "jsonMerge"', () => {
    const out = MitmProxyHost.applyResponseBodyTransform(
      { bodyTransform: 'jsonMerge', body: { added: 1, kept: 'patched' } },
      '{"orig":1,"kept":"original"}',
    );
    expect(JSON.parse(out)).to.deep.equal({ orig: 1, kept: 'patched', added: 1 });
  });

  it('falls back to replace when jsonMerge target is not parseable JSON', () => {
    const out = MitmProxyHost.applyResponseBodyTransform(
      { bodyTransform: 'jsonMerge', body: { added: 1 } },
      'not-json',
    );
    expect(JSON.parse(out)).to.deep.equal({ added: 1 });
  });

  it('treats body without bodyTransform as replace', () => {
    const out = MitmProxyHost.applyResponseBodyTransform(
      { body: { ok: true } },
      '{"original":true}',
    );
    expect(JSON.parse(out)).to.deep.equal({ ok: true });
  });

  it('returns original body unchanged when neither body nor bodyTransform is set', () => {
    const out = MitmProxyHost.applyResponseBodyTransform({}, '{"original":true}');
    expect(out).to.equal('{"original":true}');
  });
});

describe('MitmProxyHost rewriteResponse handler', () => {
  it('overrides upstream status code', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteResponse: { status: 503 },
    });
    const { host } = makeHost(engine);
    const ctx = fakeCtx();
    (host as any).handleRequest(ctx, () => {});
    (host as any).handleResponse(ctx, () => {});
    expect(ctx.serverToProxyResponse.statusCode).to.equal(503);
  });

  it('merges header overrides into upstream headers (lowercased keys)', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteResponse: { headers: { 'X-Test': 'on', 'Content-Type': 'text/plain' } },
    });
    const { host } = makeHost(engine);
    const ctx = fakeCtx();
    (host as any).handleRequest(ctx, () => {});
    (host as any).handleResponse(ctx, () => {});
    expect(ctx.serverToProxyResponse.headers['x-test']).to.equal('on');
    expect(ctx.serverToProxyResponse.headers['content-type']).to.equal('text/plain');
  });

  it('drops content-length when body rewrite is requested (chunked encoding takes over)', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteResponse: { body: { ok: true } },
    });
    const { host } = makeHost(engine);
    const ctx = fakeCtx({ resHeaders: { 'content-length': '17' } });
    (host as any).handleRequest(ctx, () => {});
    (host as any).handleResponse(ctx, () => {});
    expect(ctx.serverToProxyResponse.headers['content-length']).to.equal(undefined);
  });

  it('swallows upstream chunks and writes transformed body to client when body is rewritten', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteResponse: { bodyTransform: 'replace', body: { hijacked: true } },
    });
    const { host, emitted } = makeHost(engine);
    const ctx = fakeCtx();

    (host as any).handleRequest(ctx, () => {});
    (host as any).handleResponse(ctx, () => {});

    let forwarded: any = 'NOT_CALLED';
    (host as any).collectResData(ctx, Buffer.from('original-upstream'), (_e: any, c: any) => {
      forwarded = c;
    });
    expect(forwarded).to.equal(null);

    (host as any).finalize(ctx, () => {});

    const written = Buffer.concat(ctx.proxyToClientResponse.written).toString('utf8');
    expect(JSON.parse(written)).to.deep.equal({ hijacked: true });
    expect(emitted).to.have.length(1);
    expect(JSON.parse(emitted[0].resBody as string)).to.deep.equal({ hijacked: true });
    expect(emitted[0].modified).to.equal(true);
  });

  it('jsonMerge transforms upstream JSON before forwarding', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteResponse: { bodyTransform: 'jsonMerge', body: { patched: true } },
    });
    const { host, emitted } = makeHost(engine);
    const ctx = fakeCtx();

    (host as any).handleRequest(ctx, () => {});
    (host as any).handleResponse(ctx, () => {});
    (host as any).collectResData(ctx, Buffer.from('{"orig":1}'), () => {});
    (host as any).finalize(ctx, () => {});

    const written = Buffer.concat(ctx.proxyToClientResponse.written).toString('utf8');
    expect(JSON.parse(written)).to.deep.equal({ orig: 1, patched: true });
    expect(JSON.parse(emitted[0].resBody as string)).to.deep.equal({ orig: 1, patched: true });
  });

  it('passes through upstream chunks when only status/headers are rewritten (no body change)', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteResponse: { status: 418 },
    });
    const { host } = makeHost(engine);
    const ctx = fakeCtx();
    (host as any).handleRequest(ctx, () => {});
    (host as any).handleResponse(ctx, () => {});

    let forwarded: any;
    (host as any).collectResData(ctx, Buffer.from('upstream-body'), (_e: any, c: any) => {
      forwarded = c;
    });
    expect(forwarded?.toString('utf8')).to.equal('upstream-body');
  });
});

describe('MitmProxyHost rewriteRequest.body', () => {
  it('updates Content-Length on proxyToServerRequestOptions to match replacement byte length', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteRequest: { body: { replaced: true } },
    });
    const { host } = makeHost(engine);
    const ctx = fakeCtx({ method: 'POST' });
    (host as any).handleRequest(ctx, () => {});

    const expected = Buffer.byteLength(JSON.stringify({ replaced: true }));
    expect(ctx.proxyToServerRequestOptions.headers['content-length']).to.equal(expected);
  });

  it('defaults content-type to application/json when not already set', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteRequest: { body: { x: 1 } },
    });
    const { host } = makeHost(engine);
    const ctx = fakeCtx({ method: 'POST' });
    (host as any).handleRequest(ctx, () => {});
    expect(ctx.proxyToServerRequestOptions.headers['content-type']).to.equal('application/json');
  });

  it('preserves caller-provided content-type when rewriting body', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteRequest: {
        headers: { 'content-type': 'text/plain' },
        body: 'plain body',
      },
    });
    const { host } = makeHost(engine);
    const ctx = fakeCtx({ method: 'POST' });
    (host as any).handleRequest(ctx, () => {});
    expect(ctx.proxyToServerRequestOptions.headers['content-type']).to.equal('text/plain');
  });

  it('swallows original request chunks and writes replacement to upstream', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteRequest: { body: { replaced: true } },
    });
    const { host } = makeHost(engine);
    const ctx = fakeCtx({ method: 'POST' });
    (host as any).handleRequest(ctx, () => {});

    let forwardedChunk: any = 'NOT_CALLED';
    ctx.onRequestDataHandlers[0](ctx, Buffer.from('original'), (_e: any, c: any) => {
      forwardedChunk = c;
    });
    expect(forwardedChunk).to.equal(null);

    let endCalled = false;
    ctx.onRequestEndHandlers[0](ctx, () => {
      endCalled = true;
    });
    expect(endCalled).to.equal(true);

    const written = Buffer.concat(ctx.proxyToServerRequest.written).toString('utf8');
    expect(JSON.parse(written)).to.deep.equal({ replaced: true });
  });

  it('captured request body reflects the rewritten payload, not the original', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteRequest: { body: { replaced: true } },
    });
    const { host, emitted } = makeHost(engine);
    const ctx = fakeCtx({ method: 'POST' });
    (host as any).handleRequest(ctx, () => {});

    (host as any).collectReqData(ctx, Buffer.from('original-body'), () => {});
    ctx.onRequestEndHandlers[0](ctx, () => {});

    (host as any).finalize(ctx, () => {});

    expect(emitted).to.have.length(1);
    expect(JSON.parse(emitted[0].reqBody as string)).to.deep.equal({ replaced: true });
    expect(emitted[0].modified).to.equal(true);
  });

  it('marks tx.modified=true for header-only rewriteRequest as well', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      rewriteRequest: { headers: { authorization: 'Bearer x' } },
    });
    const { host, emitted } = makeHost(engine);
    const ctx = fakeCtx({ method: 'GET' });
    (host as any).handleRequest(ctx, () => {});
    (host as any).finalize(ctx, () => {});
    expect(emitted[0].modified).to.equal(true);
  });
});
