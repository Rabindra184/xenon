import { expect } from 'chai';
import { buildHar } from '../../../src/services/interceptor/HarBuilder';
import { CapturedRequest } from '../../../src/services/interceptor/types';

const captured = (overrides: Partial<CapturedRequest> = {}): CapturedRequest => ({
  id: 'r1',
  sessionId: 's1',
  ts: 1700000000000,
  method: 'GET',
  url: 'https://api.example.com/users/1',
  host: 'api.example.com',
  path: '/users/1',
  reqHeaders: { 'user-agent': 'test' },
  resStatus: 200,
  resHeaders: { 'content-type': 'application/json' },
  resBody: '{"ok":true}',
  durationMs: 42,
  mocked: false,
  modified: false,
  ...overrides,
});

describe('HarBuilder', () => {
  it('produces a HAR 1.2 document with creator metadata', () => {
    const har = buildHar([], 'session-x');
    expect(har.log.version).to.equal('1.2');
    expect(har.log.creator.name).to.equal('Xenon Interceptor');
    expect(Array.isArray(har.log.entries)).to.equal(true);
    expect(har.log.entries).to.have.length(0);
  });

  it('maps a captured request to a HAR entry', () => {
    const har = buildHar([captured()], 'session-x');
    expect(har.log.entries).to.have.length(1);
    const entry = har.log.entries[0];
    expect(entry.request.method).to.equal('GET');
    expect(entry.request.url).to.equal('https://api.example.com/users/1');
    expect(entry.response.status).to.equal(200);
    expect(entry.response.content.text).to.equal('{"ok":true}');
    expect(entry.response.content.mimeType).to.equal('application/json');
    expect(entry.time).to.equal(42);
  });

  it('marks mocked entries via _mocked custom field', () => {
    const har = buildHar([captured({ mocked: true, mockId: 'mock-1' })], 'session-x');
    const entry = har.log.entries[0] as any;
    expect(entry._mocked).to.equal(true);
    expect(entry._mockId).to.equal('mock-1');
  });

  it('serializes headers as name/value pairs', () => {
    const har = buildHar([captured({ reqHeaders: { 'x-a': '1', 'x-b': '2' } })], 'session-x');
    const headers = har.log.entries[0].request.headers;
    expect(headers).to.deep.include.members([
      { name: 'x-a', value: '1' },
      { name: 'x-b', value: '2' },
    ]);
  });

  it('uses ISO 8601 timestamps', () => {
    const har = buildHar([captured({ ts: Date.UTC(2024, 0, 15, 12, 30, 45) })], 'session-x');
    expect(har.log.entries[0].startedDateTime).to.equal('2024-01-15T12:30:45.000Z');
  });
});
