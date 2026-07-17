import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';

function fakeRes() {
  const res: any = { statusCode: 200 };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: any) => {
    res.body = b;
    return res;
  };
  res.cookie = () => res;
  return res;
}

describe('authMiddleware — stream-ticket branch', () => {
  let dir: string;
  let keySvc: JwtKeyService;
  let ticketSvc: StreamTicketService;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-authmw-ticket-'));
    keySvc = new JwtKeyService();
    await keySvc.init(dir);
    Container.set(JwtKeyService, keySvc);
    ticketSvc = new StreamTicketService();
    Container.set(StreamTicketService, ticketSvc);
    Container.set(UserService, { findById: sinon.stub().resolves(null) } as any);
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      verify: sinon.stub().resolves(null),
    } as any);
    Container.set(UserSessionService, { resolve: sinon.stub().resolves(null) } as any);
  });
  afterEach(() => {
    sinon.restore();
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // req.path here mirrors what authMiddleware actually sees at runtime:
  // it's mounted directly on apiRouter (src/app/index.ts line 223) BEFORE
  // ControlRouter.register(apiRouter) mounts '/control' onto that same
  // apiRouter (control.ts: parentRouter.use('/control', router)), so the
  // apiRouter-relative path for GET /xenon/api/control/UDID-1/stream is
  // '/control/UDID-1/stream' — not the full external URL.

  it('accepts a valid ticket for the matching udid on GET /control/:udid/stream', async () => {
    const ticket = await ticketSvc.mint('UDID-1', 'actor-1');
    const req: any = {
      method: 'GET',
      path: '/control/UDID-1/stream',
      query: { ticket },
      headers: {},
    };
    const res = fakeRes();
    const next = sinon.spy();
    await authMiddleware(req, res as any, next);
    expect(next.calledOnce).to.equal(true);
    expect(req.auth.kind).to.equal('stream-ticket');
    expect(req.auth.userId).to.equal('actor-1');
  });

  it('rejects a ticket minted for a different udid with 401 invalid ticket', async () => {
    const ticket = await ticketSvc.mint('UDID-1', 'actor-1');
    const req: any = {
      method: 'GET',
      path: '/control/UDID-2/stream',
      query: { ticket },
      headers: {},
    };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'invalid ticket' });
  });

  it('rejects reuse of an already-redeemed ticket', async () => {
    const ticket = await ticketSvc.mint('UDID-1', 'actor-1');
    await ticketSvc.redeem(ticket, 'UDID-1');
    const req: any = {
      method: 'GET',
      path: '/control/UDID-1/stream',
      query: { ticket },
      headers: {},
    };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'invalid ticket' });
  });

  it('does NOT match a sibling stream route (stream/status) even with a valid ticket', async () => {
    const ticket = await ticketSvc.mint('UDID-1', 'actor-1');
    const req: any = {
      method: 'GET',
      path: '/control/UDID-1/stream/status',
      query: { ticket },
      headers: {},
    };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    // Falls through to the final unauthenticated 401, not the ticket branch.
    expect(res.statusCode).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthenticated' });
  });

  it('does NOT match a POST to the stream route (ticket-mint or otherwise)', async () => {
    const ticket = await ticketSvc.mint('UDID-1', 'actor-1');
    const req: any = {
      method: 'POST',
      path: '/control/UDID-1/stream',
      query: { ticket },
      headers: {},
    };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthenticated' });
  });

  it('ignores a non-string ticket query value (e.g. array from ?ticket=a&ticket=b)', async () => {
    const req: any = {
      method: 'GET',
      path: '/control/UDID-1/stream',
      query: { ticket: ['a', 'b'] },
      headers: {},
    };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthenticated' });
  });
});
