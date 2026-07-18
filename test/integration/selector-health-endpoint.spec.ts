import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';

import { getSelectorHealth } from '../../src/app/routers/dashboard';
import { roleGuard } from '../../src/middleware/roleGuard';
import { prisma } from '../../src/prisma';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';

/**
 * Build a fake (Request, Response) pair the handler can call against.
 * Mirrors the helper in test/integration/healing-events-sessionfilter.spec.ts
 * and test/unit/healing-state-endpoints.spec.ts.
 */
function mockReqRes(req: Partial<{ body: any; params: any; query: any; apiKey: any }>) {
  const jsonStub = sinon.stub();
  const statusStub = sinon.stub().returnsThis();
  const res: any = { json: jsonStub, status: statusStub };
  const fullReq: any = {
    body: req.body ?? {},
    params: req.params ?? {},
    query: req.query ?? {},
    apiKey: req.apiKey ?? { id: 'apikey-1', scopes: 'admin', rateLimit: 0 },
  };
  return { req: fullReq, res, jsonStub, statusStub };
}

// Session log rows shaped exactly like the `select` in `aggregateHotspots`
// (dashboard.ts:452-466) — this endpoint reuses that function verbatim, so
// feeding it rows in that shape exercises the real aggregation + grouping
// logic, not a re-implementation of it.
function sessionLogRow(opts: {
  session_id: string;
  original_strategy: string | null;
  original_selector: string;
  healed_strategy?: string | null;
  healed_selector?: string | null;
  healing_confidence?: number | null;
  healing_tier?: string | null;
  createdAt: Date;
}) {
  return {
    session_id: opts.session_id,
    original_strategy: opts.original_strategy,
    original_selector: opts.original_selector,
    healed_strategy: opts.healed_strategy ?? 'accessibility id',
    healed_selector: opts.healed_selector ?? `${opts.original_selector}-healed`,
    healing_confidence: opts.healing_confidence ?? 0.9,
    healing_tier: opts.healing_tier ?? 'LLM',
    createdAt: opts.createdAt,
  };
}

describe('GET /healing/selector-health — getSelectorHealth', () => {
  let findManyStub: sinon.SinonStub;
  let stateFindManyStub: sinon.SinonStub;
  let getSignatureStub: sinon.SinonStub;

  const now = new Date('2026-07-18T12:00:00Z');
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now, toFake: ['Date'] });
    findManyStub = sinon.stub(prisma.sessionLog, 'findMany');
    stateFindManyStub = sinon.stub(prisma.selectorState, 'findMany');
    stateFindManyStub.resolves([]);
    getSignatureStub = sinon.stub(HealEtalonService.prototype, 'getSignature');
    getSignatureStub.resolves(null);
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it('returns the hotspot-mapped shape enriched with a real numeric etalonAge', async () => {
    findManyStub.resolves([
      sessionLogRow({
        session_id: 's-1',
        original_strategy: 'xpath',
        original_selector: '//login-btn',
        createdAt: now,
      }),
    ]);
    // Etalon last seen 5 minutes before "now" — etalonAge must be computed
    // for real from this, not hardcoded.
    const lastSeen = now.getTime() - 5 * 60 * 1000;
    getSignatureStub.resolves({
      selector: '//login-btn',
      strategy: 'xpath',
      attributes: {},
      nodeName: 'Button',
      lastSeen,
    });

    const { req, res, jsonStub } = mockReqRes({ query: {} });
    await getSelectorHealth(req, res);

    expect(jsonStub.calledOnce).to.be.true;
    const body = jsonStub.firstCall.args[0];
    expect(body).to.have.length(1);
    const row = body[0];
    expect(row).to.include({
      selector: '//login-btn',
      strategy: 'xpath',
      healCount: 1,
      topTier: 'LLM',
      suggestedRewrite: '//login-btn-healed',
    });
    expect(row).to.not.have.property('failRate');
    expect(row.etalonAge).to.equal(5 * 60 * 1000);
  });

  it('omits etalonAge when no matching LocatorEtalon exists', async () => {
    findManyStub.resolves([
      sessionLogRow({
        session_id: 's-1',
        original_strategy: 'xpath',
        original_selector: '//no-etalon',
        createdAt: now,
      }),
    ]);
    getSignatureStub.resolves(null);

    const { req, res, jsonStub } = mockReqRes({ query: {} });
    await getSelectorHealth(req, res);

    const row = jsonStub.firstCall.args[0][0];
    expect(row).to.not.have.property('etalonAge');
  });

  it('?selector= filters to an exact match', async () => {
    findManyStub.resolves([
      sessionLogRow({
        session_id: 's-1',
        original_strategy: 'xpath',
        original_selector: '//a',
        createdAt: now,
      }),
      sessionLogRow({
        session_id: 's-2',
        original_strategy: 'css selector',
        original_selector: '//b',
        createdAt: now,
      }),
    ]);

    const { req, res, jsonStub } = mockReqRes({ query: { selector: '//b' } });
    await getSelectorHealth(req, res);

    const body = jsonStub.firstCall.args[0];
    expect(body).to.have.length(1);
    expect(body[0].selector).to.equal('//b');
  });

  it('?limit= caps the number of rows returned', async () => {
    findManyStub.resolves([
      sessionLogRow({ session_id: 's-1', original_strategy: 'xpath', original_selector: '//a', createdAt: now }),
      sessionLogRow({ session_id: 's-2', original_strategy: 'xpath', original_selector: '//b', createdAt: now }),
      sessionLogRow({ session_id: 's-3', original_strategy: 'xpath', original_selector: '//c', createdAt: now }),
    ]);

    const { req, res, jsonStub } = mockReqRes({ query: { limit: '1' } });
    await getSelectorHealth(req, res);

    const body = jsonStub.firstCall.args[0];
    expect(body).to.have.length(1);
  });

  it('ignores an ?appId= filter (documented deferral — rows carry no app id)', async () => {
    findManyStub.resolves([
      sessionLogRow({
        session_id: 's-1',
        original_strategy: 'xpath',
        original_selector: '//a',
        createdAt: now,
      }),
    ]);

    const { req, res, jsonStub } = mockReqRes({ query: { appId: 'some-app' } });
    await getSelectorHealth(req, res);

    const body = jsonStub.firstCall.args[0];
    expect(body).to.have.length(1);
    expect(body[0].selector).to.equal('//a');
  });
});

describe('GET /healing/selector-health — MEMBER guard (router-level)', () => {
  function makeApp() {
    const app = express();
    app.use((req: any, _res, next) => {
      const role = req.headers['x-test-role'];
      if (role) req.auth = { role };
      next();
    });
    const r = express.Router();
    r.use(roleGuard('MEMBER'));
    r.get('/healing/selector-health', getSelectorHealth);
    app.use('/xenon/api', r);
    return app;
  }

  let findManyStub: sinon.SinonStub;
  let stateFindManyStub: sinon.SinonStub;
  let getSignatureStub: sinon.SinonStub;

  beforeEach(() => {
    findManyStub = sinon.stub(prisma.sessionLog, 'findMany').resolves([]);
    stateFindManyStub = sinon.stub(prisma.selectorState, 'findMany').resolves([]);
    getSignatureStub = sinon.stub(HealEtalonService.prototype, 'getSignature').resolves(null);
  });

  afterEach(() => sinon.restore());

  it('401s when unauthenticated', async () => {
    const r = await request(makeApp()).get('/xenon/api/healing/selector-health');
    expect(r.status).to.equal(401);
  });

  it('403s for a role below MEMBER', async () => {
    const r = await request(makeApp())
      .get('/xenon/api/healing/selector-health')
      .set('x-test-role', 'BOGUS');
    expect(r.status).to.equal(403);
  });

  it('200s for MEMBER', async () => {
    const r = await request(makeApp())
      .get('/xenon/api/healing/selector-health')
      .set('x-test-role', 'MEMBER');
    expect(r.status).to.equal(200);
  });

  it('200s for ADMIN', async () => {
    const r = await request(makeApp())
      .get('/xenon/api/healing/selector-health')
      .set('x-test-role', 'ADMIN');
    expect(r.status).to.equal(200);
  });
});
