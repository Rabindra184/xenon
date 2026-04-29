import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { roleGuard } from '../../src/middleware/roleGuard';
import type { Request, Response, NextFunction } from 'express';

function mkReq(auth?: any): Request {
  return { auth } as any;
}
function mkRes() {
  const res: any = {};
  res.status = sinon.stub().returns(res);
  res.json = sinon.stub().returns(res);
  return res as Response;
}

describe('roleGuard', () => {
  afterEach(() => sinon.restore());

  it('401s when req.auth is missing', () => {
    const next = sinon.stub() as unknown as NextFunction;
    const res = mkRes();
    roleGuard('MEMBER')(mkReq(undefined), res, next);
    expect((res.status as sinon.SinonStub).calledWith(401)).to.be.true;
    expect((next as sinon.SinonStub).called).to.be.false;
  });

  const PASS_MATRIX: Array<['SUPER_ADMIN' | 'ADMIN' | 'MEMBER', 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER', boolean]> = [
    ['SUPER_ADMIN', 'SUPER_ADMIN', true],
    ['SUPER_ADMIN', 'ADMIN', true],
    ['SUPER_ADMIN', 'MEMBER', true],
    ['ADMIN', 'SUPER_ADMIN', false],
    ['ADMIN', 'ADMIN', true],
    ['ADMIN', 'MEMBER', true],
    ['MEMBER', 'SUPER_ADMIN', false],
    ['MEMBER', 'ADMIN', false],
    ['MEMBER', 'MEMBER', true],
  ];

  PASS_MATRIX.forEach(([userRole, minRole, shouldPass]) => {
    it(`${userRole} vs roleGuard('${minRole}') → ${shouldPass ? 'next()' : '403'}`, () => {
      const next = sinon.stub() as unknown as NextFunction;
      const res = mkRes();
      roleGuard(minRole)(mkReq({ role: userRole, userId: 'u1', scopes: '', kind: 'user-session', rateLimit: 300 }), res, next);
      if (shouldPass) {
        expect((next as sinon.SinonStub).calledOnce).to.be.true;
        expect((res.status as sinon.SinonStub).called).to.be.false;
      } else {
        expect((res.status as sinon.SinonStub).calledWith(403)).to.be.true;
        expect((next as sinon.SinonStub).called).to.be.false;
      }
    });
  });

  it('403s fail-closed when role is an unknown value', () => {
    const next = sinon.stub() as unknown as NextFunction;
    const res = mkRes();
    roleGuard('MEMBER')(mkReq({ role: 'GHOST_ADMIN', userId: 'u1', scopes: '', kind: 'user-session', rateLimit: 300 }) as any, res, next);
    expect((res.status as sinon.SinonStub).calledWith(403)).to.be.true;
    expect((next as sinon.SinonStub).called).to.be.false;
  });
});
