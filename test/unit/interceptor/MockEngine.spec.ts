import { expect } from 'chai';
import { MockEngine } from '../../../src/services/interceptor/MockEngine';
import { Mock, RequestSummary } from '../../../src/services/interceptor/types';

const req = (overrides: Partial<RequestSummary> = {}): RequestSummary => ({
  method: 'GET',
  url: 'https://api.example.com/users/1',
  headers: {},
  ...overrides,
});

describe('MockEngine', () => {
  it('returns null when no mocks registered', () => {
    const engine = new MockEngine();
    expect(engine.match(req())).to.equal(null);
  });

  it('matches by exact string URL', () => {
    const engine = new MockEngine();
    const mock: Mock = {
      match: { url: 'https://api.example.com/users/1' },
      respondWith: { status: 200, body: { ok: true } },
    };
    engine.addMock(mock);
    const matched = engine.match(req());
    expect(matched).to.not.equal(null);
    expect(matched!.respondWith?.status).to.equal(200);
  });

  it('returns null when string URL does not match', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/other' },
      respondWith: { status: 200 },
    });
    expect(engine.match(req())).to.equal(null);
  });

  it('matches glob with single star', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/*' },
      respondWith: { status: 200 },
    });
    expect(engine.match(req({ url: 'https://api.example.com/users/42' }))).to.not.equal(null);
    expect(engine.match(req({ url: 'https://api.example.com/posts/42' }))).to.equal(null);
  });

  it('matches glob with double star across path segments', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/**' },
      respondWith: { status: 200 },
    });
    expect(engine.match(req({ url: 'https://api.example.com/a/b/c' }))).to.not.equal(null);
  });

  it('matches by RegExp URL', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: /\/users\/\d+$/ },
      respondWith: { status: 200 },
    });
    expect(engine.match(req({ url: 'https://api.example.com/users/12' }))).to.not.equal(null);
    expect(engine.match(req({ url: 'https://api.example.com/users/abc' }))).to.equal(null);
  });

  it('filters by HTTP method when specified', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1', method: 'POST' },
      respondWith: { status: 201 },
    });
    expect(engine.match(req({ method: 'GET' }))).to.equal(null);
    expect(engine.match(req({ method: 'POST' }))).to.not.equal(null);
  });

  it('treats method match as case-insensitive', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1', method: 'post' },
      respondWith: { status: 201 },
    });
    expect(engine.match(req({ method: 'POST' }))).to.not.equal(null);
  });

  it('returns the most-recently added matching mock (LIFO)', () => {
    const engine = new MockEngine();
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      respondWith: { status: 200, body: { from: 'first' } },
    });
    engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      respondWith: { status: 200, body: { from: 'second' } },
    });
    const matched = engine.match(req());
    expect((matched!.respondWith!.body as any).from).to.equal('second');
  });

  it('assigns a stable id to each added mock and surfaces it via list()', () => {
    const engine = new MockEngine();
    const id = engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      respondWith: { status: 200 },
    });
    expect(id).to.be.a('string');
    expect(id.length).to.be.greaterThan(0);
    const all = engine.list();
    expect(all).to.have.length(1);
    expect(all[0].id).to.equal(id);
  });

  it('preserves caller-supplied id on add', () => {
    const engine = new MockEngine();
    const id = engine.addMock({
      id: 'my-mock',
      match: { url: 'https://api.example.com/users/1' },
      respondWith: { status: 200 },
    });
    expect(id).to.equal('my-mock');
  });

  it('removes a mock by id', () => {
    const engine = new MockEngine();
    const id = engine.addMock({
      match: { url: 'https://api.example.com/users/1' },
      respondWith: { status: 200 },
    });
    const removed = engine.removeMock(id);
    expect(removed).to.equal(true);
    expect(engine.match(req())).to.equal(null);
    expect(engine.list()).to.have.length(0);
  });

  it('returns false when removing an unknown id', () => {
    const engine = new MockEngine();
    expect(engine.removeMock('nope')).to.equal(false);
  });

  it('clears all mocks', () => {
    const engine = new MockEngine();
    engine.addMock({ match: { url: 'a' }, respondWith: { status: 200 } });
    engine.addMock({ match: { url: 'b' }, respondWith: { status: 200 } });
    engine.clear();
    expect(engine.list()).to.have.length(0);
  });
});
