import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { collectHar } from '../../../src/services/bug-report/har-collector';
import { InterceptorService } from '../../../src/services/InterceptorService';

describe('collectHar', () => {
  afterEach(() => sinon.restore());

  it('returns null when interceptor inactive and no archive', () => {
    sinon.stub(InterceptorService.prototype, 'isActive').returns(false);
    Container.set(InterceptorService, new InterceptorService());
    const out = collectHar('sess-1', '/tmp/xenon-test-no-such-dir-' + Date.now());
    expect(out).to.equal(null);
  });

  it('returns redacted HAR JSON when interceptor active (regex-matched API key)', () => {
    const realisticKey = 'sk-' + 'a'.repeat(48);
    sinon.stub(InterceptorService.prototype, 'isActive').returns(true);
    sinon.stub(InterceptorService.prototype, 'exportHar').returns({
      log: {
        version: '1.2',
        creator: { name: 'Xenon', version: '1.0' },
        entries: [
          {
            startedDateTime: '2026-04-26T09:55:00.000Z',
            time: 100,
            request: {
              method: 'POST',
              url: 'https://example.com/login',
              headers: [{ name: 'Authorization', value: `Bearer ${realisticKey}` }],
              postData: { mimeType: 'application/json', text: `{"apiKey":"${realisticKey}"}` },
            },
            response: { status: 200, headers: [], content: { mimeType: 'application/json', text: '{}' } },
          },
        ],
      } as any,
    } as any);
    Container.set(InterceptorService, new InterceptorService());
    const out = collectHar('sess-1', '/tmp/assets');
    expect(out).to.be.a('string');
    expect(out).to.not.include(realisticKey);
    expect(out).to.include('***REDACTED***');
  });
});
