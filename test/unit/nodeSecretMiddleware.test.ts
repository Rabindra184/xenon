import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { nodeSecretMiddleware } from '../../src/middleware/nodeSecretMiddleware';
import * as legacyNodeUser from '../../src/services/identity/legacyNodeUser';
import { config } from '../../src/config';

function mkReq(headers: Record<string, string> = {}): any {
  return { headers };
}
function mkRes() {
  const res: any = {};
  res.status = sinon.stub().returns(res);
  res.json = sinon.stub().returns(res);
  return res;
}

describe('nodeSecretMiddleware (Phase 4B)', () => {
  afterEach(() => sinon.restore());

  it('pair-auth headers present → next() without touching req.auth', () => {
    const req = mkReq({
      'x-xenon-access-key': 'xen_abc',
      'x-xenon-token': 'tok',
    });
    const res = mkRes();
    const next = sinon.stub();
    nodeSecretMiddleware('expected-secret')(req, res, next);
    expect(next.calledOnce).to.be.true;
    expect(req.auth).to.be.undefined;
  });

  it('legacy header + flag on + valid secret → req.auth synthesized', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = true;
    sinon.stub(legacyNodeUser, 'ensureLegacyNodeUser').resolves({ id: 'u-legacy' });
    const req = mkReq({ 'x-xenon-node-secret': 'expected-secret' });
    const res = mkRes();
    const next = sinon.stub();
    try {
      const mw = nodeSecretMiddleware('expected-secret');
      await new Promise<void>((resolve) => {
        next.callsFake(() => resolve());
        mw(req, res, next);
      });
      expect(req.auth).to.exist;
      expect(req.auth.userId).to.equal('u-legacy');
      expect(req.auth.role).to.equal('ADMIN');
      expect(req.auth.scopes).to.equal('devices');
      expect(req.auth.kind).to.equal('api-key');
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('legacy header + flag off → 401', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = false;
    const req = mkReq({ 'x-xenon-node-secret': 'expected-secret' });
    const res = mkRes();
    const next = sinon.stub();
    try {
      nodeSecretMiddleware('expected-secret')(req, res, next);
      await new Promise((r) => setImmediate(r));
      expect((res.status as sinon.SinonStub).calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('legacy header + invalid secret → 401', async () => {
    const orig = (config as any).acceptLegacyNodeSecret;
    (config as any).acceptLegacyNodeSecret = true;
    const req = mkReq({ 'x-xenon-node-secret': 'wrong-secret' });
    const res = mkRes();
    const next = sinon.stub();
    try {
      nodeSecretMiddleware('expected-secret')(req, res, next);
      await new Promise((r) => setImmediate(r));
      expect((res.status as sinon.SinonStub).calledWith(401)).to.be.true;
    } finally {
      (config as any).acceptLegacyNodeSecret = orig;
    }
  });

  it('no auth headers → next() (downstream authMiddleware will 401)', () => {
    const req = mkReq({});
    const res = mkRes();
    const next = sinon.stub();
    nodeSecretMiddleware('expected-secret')(req, res, next);
    expect(next.calledOnce).to.be.true;
  });

  it('pair + legacy both present → pair wins, legacy ignored', () => {
    const req = mkReq({
      'x-xenon-access-key': 'xen_abc',
      'x-xenon-token': 'tok',
      'x-xenon-node-secret': 'expected-secret',
    });
    const res = mkRes();
    const next = sinon.stub();
    nodeSecretMiddleware('expected-secret')(req, res, next);
    expect(next.calledOnce).to.be.true;
    expect(req.auth).to.be.undefined;
  });
});
