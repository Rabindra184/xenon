import 'reflect-metadata';
import http from 'http';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { makeRouter } from '../../../src/app/routers/sdk-leases';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import * as leaseToken from '../../../src/services/lease/leaseToken';

/**
 * Heartbeat, extend and release take a lease id in the path and the lease
 * token in a header. They used to check that the lease existed and was
 * active before checking the token, so anyone with the `devices` scope could
 * ask about any lease id and learn whether it existed (410/404) and whether
 * it was still active (403), without holding its token.
 *
 * A caller who can't prove the lease now gets one answer, 403
 * token_mismatch, whatever state the lease is in or whether it exists. Only
 * the token's holder learns that the lease is gone.
 *
 * Driven through the real router and the real LeaseService, with the
 * database stubbed.
 */
describe('lease token routes reveal nothing without the token', () => {
  const TOKEN = 'r'.repeat(64);
  const WRONG = 'w'.repeat(64);
  const now = Date.now();
  // Built when the file loads, which in a full run can be well over a minute
  // before these tests run: a live lease must outlast the whole run.
  const LIVE_MS = 60 * 60_000;

  const base = {
    tokenHash: leaseToken.hashToken(TOKEN),
    deviceUdid: 'u1',
    deviceHost: 'h1',
    createdAt: new Date(now - 10_000),
    heartbeatSeconds: 30,
  };
  const LEASES: Record<string, any> = {
    lse_active: { ...base, id: 'lse_active', status: 'active', expiresAt: now + LIVE_MS },
    // Marked by the sweeper.
    lse_expired: { ...base, id: 'lse_expired', status: 'expired', expiresAt: now - 60_000 },
    lse_released: { ...base, id: 'lse_released', status: 'released', expiresAt: now + LIVE_MS },
    // Past expiresAt, not yet swept.
    lse_lapsed: { ...base, id: 'lse_lapsed', status: 'active', expiresAt: now - 1_000 },
  };

  let server: http.Server;
  let db: any;
  let store: any;

  beforeEach(async () => {
    db = {
      lease: {
        findUnique: sinon
          .stub()
          .callsFake(async ({ where }: any) => (LEASES[where.id] ? { ...LEASES[where.id] } : null)),
        updateMany: sinon.stub().callsFake(async ({ where }: any) => ({
          count: LEASES[where.id]?.status === 'active' ? 1 : 0,
        })),
      },
      portLease: { deleteMany: sinon.stub().resolves({ count: 0 }) },
    };
    store = { updateDevice: sinon.stub().resolves() };
    const svc = new LeaseService(
      db,
      store,
      {},
      { nodePairAuth: async () => ({ accessKey: '', token: '' }) },
    );
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.auth = {
        kind: 'user-session',
        userId: 'u-m',
        role: 'MEMBER',
        scopes: 'devices,sessions,read',
        teamIds: [],
      };
      next();
    });
    app.use('/xenon/api/sdk/leases', makeRouter({ leaseService: svc }));
    // One server for all of a test's requests. With request(app), a new
    // server per request, a run of quick requests here intermittently failed
    // with "socket hang up".
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  afterEach(async () => {
    sinon.restore();
    await new Promise((resolve) => server.close(resolve));
  });

  type Op = 'heartbeat' | 'extend' | 'release';
  function call(op: Op, id: string, token: string) {
    const url = `/xenon/api/sdk/leases/${id}`;
    if (op === 'release') return request(server).delete(url).set('x-xenon-lease-token', token);
    const r = request(server).post(`${url}/${op}`).set('x-xenon-lease-token', token);
    return op === 'extend' ? r.send({ durationMs: 60_000 }) : r;
  }
  const answer = (r: request.Response) => ({
    status: r.status,
    contentType: r.headers['content-type'],
    body: r.text,
  });

  const GONE: Record<Op, number> = { heartbeat: 410, extend: 410, release: 404 };
  const OK: Record<Op, number> = { heartbeat: 200, extend: 200, release: 204 };

  for (const op of ['heartbeat', 'extend', 'release'] as Op[]) {
    describe(op, () => {
      it('a wrong token gets the same answer for an active, expired, released or unknown lease', async () => {
        const probes: Array<[string, string]> = [
          ['lse_active', WRONG],
          ['lse_expired', WRONG],
          ['lse_released', WRONG],
          ['lse_lapsed', WRONG],
          ['lse_nope', WRONG],
          // Your own lease's token proves nothing about another id.
          ['lse_nope', TOKEN],
        ];
        const answers = [];
        for (const [id, token] of probes)
          answers.push({ id, ...answer(await call(op, id, token)) });
        for (const a of answers) {
          expect({ status: a.status, body: a.body }, a.id).to.deep.equal({
            status: 403,
            body: JSON.stringify({ error: 'token_mismatch' }),
          });
          expect(a.contentType, a.id).to.equal(answers[0].contentType);
        }
      });

      it('a wrong token changes nothing', async () => {
        for (const id of ['lse_active', 'lse_expired', 'lse_released', 'lse_nope']) {
          await call(op, id, WRONG);
        }
        expect(db.lease.updateMany.called).to.equal(false);
        expect(db.portLease.deleteMany.called).to.equal(false);
        expect(store.updateDevice.called).to.equal(false);
      });

      it(`the right token on an expired lease gets ${GONE[op]}`, async () => {
        expect((await call(op, 'lse_expired', TOKEN)).status).to.equal(GONE[op]);
      });

      it(`the right token on a released lease gets ${GONE[op]}`, async () => {
        expect((await call(op, 'lse_released', TOKEN)).status).to.equal(GONE[op]);
      });

      it(`the right token on an active lease gets ${OK[op]}`, async () => {
        expect((await call(op, 'lse_active', TOKEN)).status).to.equal(OK[op]);
      });
    });
  }

  // Neither may keep a lapsed lease alive: extend used to push its expiresAt
  // out again and reset its heartbeat clock, so the sweeper never took it.
  for (const op of ['heartbeat', 'extend'] as const) {
    it(`${op}: the right token on a lease past its expiry, not yet swept, gets 410 and changes nothing`, async () => {
      const r = await call(op, 'lse_lapsed', TOKEN);
      expect({ status: r.status, error: r.body.error }).to.deep.equal({
        status: 410,
        error: 'gone',
      });
      expect(db.lease.updateMany.called).to.equal(false);
    });
  }

  it('an unknown id still costs one token comparison, against one fixed hash', async () => {
    const verify = sinon.spy(leaseToken, 'verifyToken');
    await call('heartbeat', 'lse_nope', WRONG);
    await call('extend', 'lse_other', TOKEN);
    expect(verify.callCount).to.equal(2);
    const [first, second] = verify.getCalls().map((c) => c.args);
    expect(first[0]).to.equal(WRONG);
    expect(second[0]).to.equal(TOKEN);
    // Same length as a real hash, so the comparison does the same work.
    expect(first[1]).to.match(/^[0-9a-f]{64}$/);
    expect(second[1]).to.equal(first[1]);
  });
});
