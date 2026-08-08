import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ControlRouter from '../../src/app/routers/control';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';
import { authMiddleware, scopesForRole } from '../../src/middleware/authMiddleware';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';

/**
 * `req.auth.userId` must always hold a User id.
 *
 * The whole ownership model added in #216/#217 rests on that: locks are written
 * as manual_<userId>_<udid>, and every reader compares against req.auth.userId.
 *
 * stream/ticket used to mint with `req.apiKey?.id ?? req.auth?.userId`. On the
 * header-pair credential path authMiddleware populates BOTH, in different id
 * spaces, so the ticket carried an ApiKey row id — and authMiddleware's redeem
 * branch assigns the ticket's actor straight into req.auth.userId. The
 * invariant was therefore false for any request authenticated by a ticket.
 *
 * It is not currently exploitable (the ticket branch only matches
 * GET /control/:udid/stream, and the ownership guard skips GETs), but it means
 * a future reader of req.auth.userId cannot trust what it holds.
 */
const UDID = 'UDID-1';
const ALICE_USER = 'usr_alice';
const ALICE_KEY = 'key_abc';

describe('stream/ticket carries the user identity, not the credential', () => {
  let dir: string;
  let ticketSvc: StreamTicketService;

  function buildApp(caller: { userId?: string; apiKeyId?: string } = {}) {
    const app = express();
    app.use(express.json());
    const apiRouter = express.Router();
    apiRouter.use((req, _res, next) => {
      if (caller.userId) {
        (req as any).auth = {
          kind: 'api-key',
          userId: caller.userId,
          role: 'MEMBER',
          scopes: scopesForRole('MEMBER'),
          apiKeyId: caller.apiKeyId,
          rateLimit: 100,
        };
        // authMiddleware sets req.apiKey ONLY on the header-pair path, with the
        // ApiKey row id — a different id space from userId. That divergence is
        // the whole point of this test.
        if (caller.apiKeyId) {
          (req as any).apiKey = { id: caller.apiKeyId, scopes: 'devices', rateLimit: 100 };
        }
      }
      next();
    });
    ControlRouter.register(apiRouter);
    app.use('/xenon/api', apiRouter);
    return app;
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-ticket-identity-'));
    const keySvc = new JwtKeyService();
    await keySvc.init(dir);
    Container.set(JwtKeyService, keySvc);
    ticketSvc = new StreamTicketService();
    Container.set(StreamTicketService, ticketSvc);
    Container.set(UserService, { findById: sinon.stub().resolves(null) } as any);
    // A real ApiKeyService: scopeGuard calls hasScope(), so a partial stub
    // 500s the request before the handler is reached. No credentials are
    // presented in these tests, so verifyPair/verify are never exercised.
    Container.set(ApiKeyService, new ApiKeyService());
    Container.set(UserSessionService, { resolve: sinon.stub().resolves(null) } as any);
  });

  afterEach(() => {
    sinon.restore();
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const mint = (caller: { userId?: string; apiKeyId?: string }) =>
    request(buildApp(caller)).post(`/xenon/api/control/${UDID}/stream/ticket`);

  it('mints with the userId even when a different apiKey id is present', async () => {
    const res = await mint({ userId: ALICE_USER, apiKeyId: ALICE_KEY });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);

    const { actorId } = await ticketSvc.redeem(res.body.ticket, UDID);
    expect(actorId).to.equal(ALICE_USER);
    expect(actorId).to.not.equal(ALICE_KEY);
  });

  it('mints with the userId on a cookie session (no req.apiKey at all)', async () => {
    const res = await mint({ userId: ALICE_USER });
    expect(res.status).to.equal(200);

    const { actorId } = await ticketSvc.redeem(res.body.ticket, UDID);
    expect(actorId).to.equal(ALICE_USER);
  });

  it('redeeming through authMiddleware puts a User id in req.auth.userId', async () => {
    const res = await mint({ userId: ALICE_USER, apiKeyId: ALICE_KEY });
    const req: any = {
      method: 'GET',
      path: `/control/${UDID}/stream`,
      query: { ticket: res.body.ticket },
      headers: {},
    };
    const httpRes: any = {
      statusCode: 200,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      json(b: any) {
        this.body = b;
        return this;
      },
    };
    const next = sinon.spy();

    await authMiddleware(req, httpRes, next);

    expect(next.calledOnce).to.equal(true);
    expect(req.auth.kind).to.equal('stream-ticket');
    // The invariant: this is a User id, never an ApiKey id.
    expect(req.auth.userId).to.equal(ALICE_USER);
  });

  it('401s an unauthenticated mint', async () => {
    const res = await mint({});
    expect(res.status).to.equal(401);
  });
});
