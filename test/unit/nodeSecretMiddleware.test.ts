import { expect } from 'chai';
import sinon from 'sinon';
import { nodeSecretMiddleware } from '../../src/middleware/nodeSecretMiddleware';

function mockReq(headers: Record<string, string> = {}) {
  return { headers } as any;
}
function mockRes() {
  const json = sinon.stub();
  const status = sinon.stub().returnsThis();
  return { status, json } as any;
}

describe('nodeSecretMiddleware', () => {
  it('401 on mismatch when secret is configured', () => {
    const mw = nodeSecretMiddleware('expected');
    const req = mockReq({ 'x-xenon-node-secret': 'wrong' });
    const res = mockRes();
    const next = sinon.stub();
    mw(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
  });

  it('calls next on match', () => {
    const mw = nodeSecretMiddleware('shared');
    const next = sinon.stub();
    mw(mockReq({ 'x-xenon-node-secret': 'shared' }), mockRes(), next);
    expect(next.calledOnce).to.be.true;
  });

  it('permits + warns when secret unset', () => {
    const mw = nodeSecretMiddleware(undefined);
    const next = sinon.stub();
    mw(mockReq(), mockRes(), next);
    expect(next.calledOnce).to.be.true;
  });
});
