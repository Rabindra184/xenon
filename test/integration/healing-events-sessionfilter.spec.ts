import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

import { getRecentHealingEvents } from '../../src/app/routers/dashboard';
import { prisma } from '../../src/prisma';

/**
 * Build a fake (Request, Response) pair the handler can call against.
 * Mirrors the helper in test/unit/healing-state-endpoints.spec.ts.
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

describe('GET /healing/events?sessionId= — getRecentHealingEvents', () => {
  let findManyStub: sinon.SinonStub;
  let countStub: sinon.SinonStub;

  const rowA = {
    id: 'log-a',
    session_id: 'session-A',
    command_name: 'findElement',
    original_selector: '//a',
    healed_selector: 'a-healed',
    healing_confidence: 0.9,
    healing_tier: 'LLM',
    is_success: true,
    createdAt: new Date('2026-07-18T09:00:00Z'),
    session: { id: 'session-A', device_udid: 'udid-a', device_name: 'pixel-a', device_platform: 'android' },
  };

  const rowB = {
    id: 'log-b',
    session_id: 'session-B',
    command_name: 'findElement',
    original_selector: '//b',
    healed_selector: 'b-healed',
    healing_confidence: 0.8,
    healing_tier: 'OCR',
    is_success: true,
    createdAt: new Date('2026-07-18T08:00:00Z'),
    session: { id: 'session-B', device_udid: 'udid-b', device_name: 'pixel-b', device_platform: 'ios' },
  };

  beforeEach(() => {
    findManyStub = sinon.stub(prisma.sessionLog, 'findMany');
    countStub = sinon.stub(prisma.sessionLog, 'count');
    countStub.resolves(2);
  });

  afterEach(() => sinon.restore());

  it('filters to a single session when ?sessionId= is given', async () => {
    findManyStub.resolves([rowA]);

    const { req, res, jsonStub } = mockReqRes({ query: { sessionId: 'session-A' } });
    await getRecentHealingEvents(req, res);

    expect(findManyStub.firstCall.args[0].where).to.deep.equal({
      is_healed: true,
      session_id: 'session-A',
    });
    const body = jsonStub.firstCall.args[0];
    expect(body.events).to.have.length(1);
    expect(body.events[0].sessionId).to.equal('session-A');
  });

  it('returns all healed events when no sessionId is given (regression)', async () => {
    findManyStub.resolves([rowA, rowB]);

    const { req, res, jsonStub } = mockReqRes({ query: {} });
    await getRecentHealingEvents(req, res);

    expect(findManyStub.firstCall.args[0].where).to.deep.equal({ is_healed: true });
    const body = jsonStub.firstCall.args[0];
    expect(body.events).to.have.length(2);
    expect(body.events.map((e: any) => e.sessionId)).to.have.members(['session-A', 'session-B']);
  });

  it('composes ?sessionId= with ?limit=', async () => {
    findManyStub.resolves([rowA]);

    const { req, res } = mockReqRes({ query: { sessionId: 'session-A', limit: '5' } });
    await getRecentHealingEvents(req, res);

    expect(findManyStub.firstCall.args[0]).to.deep.include({
      where: { is_healed: true, session_id: 'session-A' },
      take: 5,
    });
  });
});
