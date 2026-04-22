import { expect } from 'chai';
import sinon from 'sinon';
import { rateLimitMiddleware, __resetBucketsForTests } from '../../src/middleware/rateLimitMiddleware';

function mockReq(keyId: string, rateLimit: number) {
  return { apiKey: { id: keyId, rateLimit } } as any;
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
});
