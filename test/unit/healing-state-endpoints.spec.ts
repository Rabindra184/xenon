import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

import {
  postSelectorStateAction,
  getMutedSelectors,
  getSelectorStateByTuple,
} from '../../src/app/routers/dashboard';
import { SelectorStateService, SelectorStateConflictError } from '../../src/services/SelectorStateService';
import { prisma } from '../../src/prisma';

/**
 * Build a fake (Request, Response) pair the handlers can call against.
 * `res.status(...).json(...)` chaining is supported via `returnsThis()`.
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

describe('POST /healing/selector/state — postSelectorStateAction', () => {
  let markFixedStub: sinon.SinonStub;
  let muteStub: sinon.SinonStub;
  let unmuteStub: sinon.SinonStub;
  let cancelStub: sinon.SinonStub;

  beforeEach(() => {
    markFixedStub = sinon.stub(SelectorStateService.prototype, 'markFixed');
    muteStub = sinon.stub(SelectorStateService.prototype, 'mute');
    unmuteStub = sinon.stub(SelectorStateService.prototype, 'unmute');
    cancelStub = sinon.stub(SelectorStateService.prototype, 'cancelVerification');
  });

  afterEach(() => sinon.restore());

  it('mark_fixed action returns the new state', async () => {
    markFixedStub.resolves({
      original_strategy: 'xpath',
      original_selector: '//x',
      status: 'pending',
    } as any);

    const { req, res, jsonStub } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'mark_fixed' },
    });
    await postSelectorStateAction(req, res);

    expect(markFixedStub.calledOnce).to.be.true;
    expect(markFixedStub.firstCall.args[0]).to.deep.equal({
      strategy: 'xpath',
      selector: '//x',
      apiKeyId: 'apikey-1',
    });
    expect(jsonStub.calledOnce).to.be.true;
    expect(jsonStub.firstCall.args[0].state.status).to.equal('pending');
  });

  it('mute action calls the mute service', async () => {
    muteStub.resolves({
      original_strategy: 'xpath',
      original_selector: '//x',
      status: 'muted',
    } as any);

    const { req, res } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'mute' },
    });
    await postSelectorStateAction(req, res);

    expect(muteStub.calledOnce).to.be.true;
    expect(markFixedStub.called).to.be.false;
  });

  it('unmute action calls the unmute service', async () => {
    unmuteStub.resolves({
      original_strategy: 'xpath',
      original_selector: '//x',
      status: 'active',
    } as any);

    const { req, res } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'unmute' },
    });
    await postSelectorStateAction(req, res);

    expect(unmuteStub.calledOnce).to.be.true;
  });

  it('cancel_verification action calls the cancelVerification service', async () => {
    cancelStub.resolves({
      original_strategy: 'xpath',
      original_selector: '//x',
      status: 'active',
    } as any);

    const { req, res } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'cancel_verification' },
    });
    await postSelectorStateAction(req, res);

    expect(cancelStub.calledOnce).to.be.true;
  });

  it('returns 409 with currentStatus when service throws SelectorStateConflictError', async () => {
    markFixedStub.rejects(new SelectorStateConflictError('Cannot markFixed on a muted selector', 'muted'));

    const { req, res, statusStub, jsonStub } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'mark_fixed' },
    });
    await postSelectorStateAction(req, res);

    expect(statusStub.calledWith(409)).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.have.property('currentStatus', 'muted');
    expect(jsonStub.firstCall.args[0].error).to.match(/muted/i);
  });

  it('returns 400 for invalid action', async () => {
    const { req, res, statusStub, jsonStub } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'do_a_dance' },
    });
    await postSelectorStateAction(req, res);

    expect(statusStub.calledWith(400)).to.be.true;
    expect(jsonStub.firstCall.args[0].error).to.match(/action must be one of/i);
  });

  it('returns 400 when required fields are missing', async () => {
    const { req, res, statusStub } = mockReqRes({
      body: { action: 'mute' },
    });
    await postSelectorStateAction(req, res);

    expect(statusStub.calledWith(400)).to.be.true;
  });

  it('returns 500 on unexpected service errors', async () => {
    markFixedStub.rejects(new Error('database is on fire'));

    const { req, res, statusStub, jsonStub } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'mark_fixed' },
    });
    await postSelectorStateAction(req, res);

    expect(statusStub.calledWith(500)).to.be.true;
    expect(jsonStub.firstCall.args[0]).to.have.property('error', 'internal');
  });
});

describe('GET /healing/state/muted — getMutedSelectors', () => {
  let findManyStub: sinon.SinonStub;
  let countStub: sinon.SinonStub;
  let sessionLogFindFirstStub: sinon.SinonStub;

  beforeEach(() => {
    findManyStub = sinon.stub(prisma.selectorState, 'findMany');
    countStub = sinon.stub(prisma.selectorState, 'count');
    sessionLogFindFirstStub = sinon.stub(prisma.sessionLog, 'findFirst');
  });

  afterEach(() => sinon.restore());

  it('returns muted rows with last_healed_at enrichment and pagination', async () => {
    const mutedAt = new Date('2026-04-20T10:00:00Z');
    const lastHealedAt = new Date('2026-04-15T08:00:00Z');
    findManyStub.resolves([
      {
        original_strategy: 'xpath',
        original_selector: "//button[@id='ok']",
        muted_at: mutedAt,
        muted_by_api_key: 'ak_alice',
        regression_count: 2,
      } as any,
    ]);
    countStub.resolves(1);
    sessionLogFindFirstStub.resolves({ createdAt: lastHealedAt } as any);

    const { req, res, jsonStub } = mockReqRes({ query: { limit: '50', offset: '0' } });
    await getMutedSelectors(req, res);

    expect(findManyStub.calledOnce).to.be.true;
    expect(findManyStub.firstCall.args[0]).to.deep.include({
      where: { status: 'muted' },
      take: 50,
      skip: 0,
    });
    const body = jsonStub.firstCall.args[0];
    expect(body.muted).to.have.length(1);
    expect(body.muted[0]).to.deep.include({
      original_strategy: 'xpath',
      original_selector: "//button[@id='ok']",
      muted_by_api_key: 'ak_alice',
      regression_count: 2,
    });
    expect(body.muted[0].muted_at).to.equal(mutedAt.toISOString());
    expect(body.muted[0].last_healed_at).to.equal(lastHealedAt.toISOString());
    expect(body.total).to.equal(1);
    expect(body.limit).to.equal(50);
    expect(body.offset).to.equal(0);
  });

  it('clamps limit to a sane maximum', async () => {
    findManyStub.resolves([]);
    countStub.resolves(0);

    const { req, res } = mockReqRes({ query: { limit: '99999' } });
    await getMutedSelectors(req, res);

    expect(findManyStub.firstCall.args[0].take).to.equal(200);
  });

  it('returns null last_healed_at when no heal has been recorded', async () => {
    findManyStub.resolves([
      {
        original_strategy: 'xpath',
        original_selector: '//x',
        muted_at: new Date(),
        muted_by_api_key: null,
        regression_count: 0,
      } as any,
    ]);
    countStub.resolves(1);
    sessionLogFindFirstStub.resolves(null);

    const { req, res, jsonStub } = mockReqRes({ query: {} });
    await getMutedSelectors(req, res);

    expect(jsonStub.firstCall.args[0].muted[0].last_healed_at).to.equal(null);
  });
});

describe('GET /healing/state/:strategy/:value — getSelectorStateByTuple', () => {
  let findUniqueStub: sinon.SinonStub;

  beforeEach(() => {
    findUniqueStub = sinon.stub(prisma.selectorState, 'findUnique');
  });

  afterEach(() => sinon.restore());

  it('returns the row for a URL-encoded tuple', async () => {
    findUniqueStub.resolves({
      original_strategy: 'accessibility id',
      original_selector: 'login-btn',
      status: 'pending',
    } as any);

    const { req, res, jsonStub } = mockReqRes({
      params: {
        strategy: encodeURIComponent('accessibility id'),
        value: encodeURIComponent('login-btn'),
      },
    });
    await getSelectorStateByTuple(req, res);

    expect(findUniqueStub.calledOnce).to.be.true;
    expect(findUniqueStub.firstCall.args[0]).to.deep.equal({
      where: {
        original_strategy_original_selector: {
          original_strategy: 'accessibility id',
          original_selector: 'login-btn',
        },
      },
    });
    expect(jsonStub.firstCall.args[0].state.status).to.equal('pending');
  });

  it('returns { state: null } when no row exists', async () => {
    findUniqueStub.resolves(null);

    const { req, res, jsonStub } = mockReqRes({
      params: { strategy: 'xpath', value: '//x' },
    });
    await getSelectorStateByTuple(req, res);

    expect(jsonStub.firstCall.args[0]).to.deep.equal({ state: null });
  });
});
