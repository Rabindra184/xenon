import { expect } from 'chai';
import { UniversalMjpegProxy, shouldRecreateMjpegProxy } from '../../src/helpers/UniversalMjpegProxy';

// Regression guard for the iOS preview "503 forever" bug: once a cached
// UniversalMjpegProxy self-destructs (MAX_RETRIES -> stop() -> isStopped=true),
// the GET /stream handler must NOT reuse it. Reusing a stopped proxy makes every
// subsequent request short-circuit to 503 (2-8ms, 47-byte body) even after WDA
// has fully recovered on the same port, because the upstream url is unchanged.
describe('shouldRecreateMjpegProxy', () => {
  const url = 'http://127.0.0.1:9100';

  it('recreates when there is no cached proxy', () => {
    expect(shouldRecreateMjpegProxy(undefined, url)).to.equal(true);
  });

  it('recreates when the upstream url changed', () => {
    expect(shouldRecreateMjpegProxy({ url: 'http://127.0.0.1:9101', stopped: false }, url)).to.equal(
      true,
    );
  });

  it('recreates when the cached proxy is stopped (zombie), even if the url matches', () => {
    expect(shouldRecreateMjpegProxy({ url, stopped: true }, url)).to.equal(true);
  });

  it('reuses a live cached proxy on the same url', () => {
    expect(shouldRecreateMjpegProxy({ url, stopped: false }, url)).to.equal(false);
  });
});

describe('UniversalMjpegProxy.stopped', () => {
  it('is false for a fresh proxy', () => {
    const p = new UniversalMjpegProxy('http://127.0.0.1:9100');
    expect(p.stopped).to.equal(false);
  });

  it('is true after stop()', () => {
    const p = new UniversalMjpegProxy('http://127.0.0.1:9100');
    p.stop();
    expect(p.stopped).to.equal(true);
  });
});
