import { expect } from 'chai';
import sinon from 'sinon';
import {
  rateLimitMiddleware,
  __resetBucketsForTests,
} from '../../src/middleware/rateLimitMiddleware';

// A non-GET, non-heavy path lands in the 'control' bucket, whose capacity is
// the key's rateLimit. The middleware reads method and path to pick a bucket.
function mockReq(keyId: string, rateLimit: number) {
  return { apiKey: { id: keyId, rateLimit }, method: 'POST', path: '/control/u1/tap' } as any;
}
function mockRes() {
  const json = sinon.stub();
  const status = sinon.stub().returnsThis();
  const set = sinon.stub();
  return { status, json, set } as any;
}

describe('rateLimitMiddleware', () => {
  beforeEach(() => __resetBucketsForTests());

  it('allows traffic within the limit', () => {
    const next = sinon.stub();
    const mw = rateLimitMiddleware();
    for (let i = 0; i < 5; i++) mw(mockReq('k1', 60), mockRes(), next);
    expect(next.callCount).to.equal(5);
  });

  it('429 when bucket exhausted', () => {
    const next = sinon.stub();
    const mw = rateLimitMiddleware();
    const req = mockReq('k2', 3);
    const res = mockRes();
    for (let i = 0; i < 3; i++) mw(req, res, next);
    mw(req, res, next);
    expect(res.status.calledWith(429)).to.be.true;
  });

  describe('signed-in users and bearer tokens', () => {
    // Through 2.12 only API keys were limited: a cookie session or a bearer
    // token, which carry no key, could send without limit.
    const userReq = (kind: string, userId: string, method = 'POST', path = '/control/u1/tap') =>
      ({ auth: { kind, userId, rateLimit: 3 }, method, path }) as any;

    for (const kind of ['user-session', 'bearer']) {
      it(`limits a ${kind} caller's changes to its budget`, () => {
        const next = sinon.stub();
        const mw = rateLimitMiddleware();
        const res = mockRes();
        for (let i = 0; i < 4; i++) mw(userReq(kind, `u-${kind}`), res, next);
        expect(next.callCount).to.equal(3);
        expect(res.status.calledWith(429)).to.equal(true);
      });
    }

    it("shares one budget across a user's sessions and tokens", () => {
      const next = sinon.stub();
      const mw = rateLimitMiddleware();
      const res = mockRes();
      mw(userReq('user-session', 'dana'), res, next);
      mw(userReq('bearer', 'dana'), res, next);
      mw(userReq('user-session', 'dana'), res, next);
      mw(userReq('bearer', 'dana'), res, next);
      expect(next.callCount).to.equal(3);
    });

    it('keeps users apart', () => {
      const next = sinon.stub();
      const mw = rateLimitMiddleware();
      for (let i = 0; i < 3; i++) mw(userReq('user-session', 'dana'), mockRes(), next);
      mw(userReq('user-session', 'lee'), mockRes(), next);
      expect(next.callCount).to.equal(4);
    });

    it('gives their reads ten times the budget', () => {
      const next = sinon.stub();
      const mw = rateLimitMiddleware();
      const res = mockRes();
      for (let i = 0; i < 31; i++)
        mw(userReq('user-session', 'reader', 'GET', '/devices'), res, next);
      expect(next.callCount).to.equal(30);
    });

    it('leaves single-use tickets unlimited', () => {
      const next = sinon.stub();
      const mw = rateLimitMiddleware();
      for (let i = 0; i < 5; i++)
        mw(userReq('stream-ticket', 'dana', 'GET', '/control/u1/stream'), mockRes(), next);
      expect(next.callCount).to.equal(5);
    });
  });
});
