import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
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

  // Stream tickets carry a signed `isAdmin` claim (StreamTicketService.mint's
  // third argument), used by the logcat WebSocket's ownership re-check. This
  // REST-facing branch deliberately does NOT read it: it destructures only
  // `{ actorId }` from the redeemed payload and hardcodes `role: 'MEMBER'`,
  // `scopes: 'read'`. That constraint currently lives only in the shape of a
  // destructuring pattern -- one careless line ("const { actorId, isAdmin }"
  // piped into role/scopes) turns a diagnostic claim into a privilege
  // escalation path. Mint a ticket that actually claims admin and assert the
  // resulting req.auth still comes out as a plain, unprivileged member.
  it("never elevates req.auth from an admin-minted ticket's isAdmin claim", async () => {
    const ticket = await ticketSvc.mint('UDID-1', 'actor-1', { isAdmin: true });
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
    expect(req.auth.role).to.equal('MEMBER');
    expect(req.auth.scopes).to.equal('read');
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

// Mount-order guard: the hand-built-req tests above hardcode
// req.path='/control/UDID-1/stream', so they'd keep passing even if a future
// change to how authMiddleware / ControlRouter are mounted stopped delivering
// that apiRouter-relative path to the middleware — silently reopening "does
// the ticket branch even fire?". This block wires the REAL chain the same way
// src/app/index.ts does (apiRouter.use(authMiddleware); ControlRouter mounts
// '/control' onto apiRouter) and drives an actual HTTP request through it, so
// a regression in the mount path is caught end-to-end. The device store is
// stubbed to report "no such device", so a request that clears auth lands on
// the route handler's 404 — distinct from authMiddleware's 401. Asserting
// "not 401 unauthenticated" therefore proves the ticket branch fired.
describe('authMiddleware — stream-ticket branch (real mount-order, supertest)', () => {
  let dir: string;
  let app: express.Express;
  let ticketSvc: StreamTicketService;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-authmw-mount-'));
    const keySvc = new JwtKeyService();
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

    // Clean 404 path: the GET /:udid/stream handler's first act is
    // getDeviceInfo(udid) -> DeviceStoreFactory.getStore().findDevice(...).
    // Return no device so the handler responds 404 'Device not found' the
    // moment it runs — which only happens if auth (the ticket branch) passed.
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns({ findDevice: sinon.stub().resolves(undefined) } as any);

    // Mount exactly like src/app/index.ts: authMiddleware directly on the
    // apiRouter, THEN ControlRouter.register(apiRouter) mounts '/control'.
    const apiRouter = express.Router();
    apiRouter.use(authMiddleware);
    ControlRouter.register(apiRouter);
    app = express();
    app.use('/xenon/api', apiRouter);
  });
  afterEach(() => {
    sinon.restore();
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a valid ticket on GET /xenon/api/control/:udid/stream reaches the route (past 401)', async () => {
    const ticket = await ticketSvc.mint('UDID-1', 'actor-1');
    const res = await request(app).get('/xenon/api/control/UDID-1/stream').query({ ticket });
    // The ticket branch fired: request cleared auth and hit the handler's
    // device lookup (404), rather than being rejected at the middleware (401).
    expect(res.status).to.not.equal(401);
    expect(res.status).to.equal(404); // 'Device not found' from the stubbed store
  });

  it('the SAME request without a ticket is rejected 401 (proves the guard is non-vacuous)', async () => {
    const res = await request(app).get('/xenon/api/control/UDID-1/stream');
    expect(res.status).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthenticated' });
  });
});
