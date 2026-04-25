import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { prisma } from '../../src/prisma';
import { aggregateHotspots } from '../../src/app/routers/dashboard';

/**
 * Build a partial sessionLog row matching the columns aggregateHotspots
 * selects. Caller can override any field. createdAt defaults to "now"
 * unless overridden so the windowDays filter doesn't matter.
 */
function makeHealRow(overrides: Partial<any> = {}) {
  return {
    session_id: 'session-1',
    original_strategy: 'xpath',
    original_selector: '//button[@id="login"]',
    healed_strategy: 'accessibility id',
    healed_selector: 'login-btn',
    healing_confidence: 0.9,
    healing_tier: 'Fuzzy XML',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeStateRow(overrides: Partial<any> = {}) {
  return {
    id: 'state-1',
    original_strategy: 'xpath',
    original_selector: '//button[@id="login"]',
    status: 'active',
    fixed_at: null,
    fixed_by_api_key: null,
    resolved_at: null,
    muted_at: null,
    muted_by_api_key: null,
    regression_count: 0,
    clean_builds_count: 0,
    last_event_at: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('aggregateHotspots — tuple-keyed grouping & status filter', () => {
  let sessionLogStub: sinon.SinonStub;
  let selectorStateStub: sinon.SinonStub;

  beforeEach(() => {
    sessionLogStub = sinon.stub(prisma.sessionLog, 'findMany');
    selectorStateStub = sinon.stub(prisma.selectorState, 'findMany').resolves([]);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('groups separate (strategy, value) tuples as separate hotspots', async () => {
    sessionLogStub.resolves([
      makeHealRow({ original_strategy: 'xpath', original_selector: 'login-btn' }),
      makeHealRow({ original_strategy: 'xpath', original_selector: 'login-btn' }),
      makeHealRow({
        original_strategy: 'accessibility id',
        original_selector: 'login-btn',
      }),
    ]);

    const agg = await aggregateHotspots({ windowDays: 7, limit: 10 });

    expect(agg.hotspots).to.have.length(2);
    const xpathRow = agg.hotspots.find((h) => h.originalStrategy === 'xpath');
    const accidRow = agg.hotspots.find((h) => h.originalStrategy === 'accessibility id');
    expect(xpathRow).to.exist;
    expect(accidRow).to.exist;
    expect(xpathRow!.healCount).to.equal(2);
    expect(accidRow!.healCount).to.equal(1);
    expect(xpathRow!.originalSelector).to.equal('login-btn');
    expect(accidRow!.originalSelector).to.equal('login-btn');
  });

  it('places null original_strategy heals into a separate bucket', async () => {
    sessionLogStub.resolves([
      makeHealRow({ original_strategy: null, original_selector: 'mystery-btn' }),
    ]);

    const agg = await aggregateHotspots({ windowDays: 7, limit: 10 });

    expect(agg.hotspots).to.have.length(1);
    expect(agg.hotspots[0].originalStrategy).to.equal(null);
    expect(agg.hotspots[0].originalSelector).to.equal('mystery-btn');
    expect(agg.hotspots[0].healCount).to.equal(1);
  });

  it('default `active` status excludes muted hotspots', async () => {
    sessionLogStub.resolves([
      makeHealRow({ original_strategy: 'xpath', original_selector: 'sel-a' }),
      makeHealRow({ original_strategy: 'xpath', original_selector: 'sel-b' }),
    ]);
    selectorStateStub.resolves([
      makeStateRow({
        original_strategy: 'xpath',
        original_selector: 'sel-b',
        status: 'muted',
      }),
    ]);

    const agg = await aggregateHotspots({ windowDays: 7, limit: 10 });

    expect(agg.hotspots).to.have.length(1);
    expect(agg.hotspots[0].originalSelector).to.equal('sel-a');
  });

  it('status=pending returns only pending hotspots', async () => {
    sessionLogStub.resolves([
      makeHealRow({ original_strategy: 'xpath', original_selector: 'sel-pending' }),
      makeHealRow({ original_strategy: 'xpath', original_selector: 'sel-resolved' }),
    ]);
    selectorStateStub.resolves([
      makeStateRow({
        original_strategy: 'xpath',
        original_selector: 'sel-pending',
        status: 'pending',
      }),
      makeStateRow({
        original_strategy: 'xpath',
        original_selector: 'sel-resolved',
        status: 'resolved',
      }),
    ]);

    const agg = await aggregateHotspots({
      windowDays: 7,
      limit: 10,
      status: 'pending',
    });

    expect(agg.hotspots).to.have.length(1);
    expect(agg.hotspots[0].originalSelector).to.equal('sel-pending');
    expect(agg.hotspots[0].state?.status).to.equal('pending');
  });

  it('status=all returns all hotspots regardless of state', async () => {
    sessionLogStub.resolves([
      makeHealRow({ original_strategy: 'xpath', original_selector: 'sel-active' }),
      makeHealRow({ original_strategy: 'xpath', original_selector: 'sel-muted' }),
      makeHealRow({ original_strategy: 'xpath', original_selector: 'sel-pending' }),
      makeHealRow({ original_strategy: 'xpath', original_selector: 'sel-resolved' }),
    ]);
    selectorStateStub.resolves([
      makeStateRow({
        original_strategy: 'xpath',
        original_selector: 'sel-muted',
        status: 'muted',
      }),
      makeStateRow({
        original_strategy: 'xpath',
        original_selector: 'sel-pending',
        status: 'pending',
      }),
      makeStateRow({
        original_strategy: 'xpath',
        original_selector: 'sel-resolved',
        status: 'resolved',
      }),
    ]);

    const agg = await aggregateHotspots({
      windowDays: 7,
      limit: 10,
      status: 'all',
    });

    expect(agg.hotspots).to.have.length(4);
  });

  it('suggestedStrategy is the mode of healed_strategy values', async () => {
    sessionLogStub.resolves([
      makeHealRow({
        original_strategy: 'xpath',
        original_selector: 'login-btn',
        healed_strategy: 'accessibility id',
      }),
      makeHealRow({
        original_strategy: 'xpath',
        original_selector: 'login-btn',
        healed_strategy: 'accessibility id',
      }),
    ]);

    const agg = await aggregateHotspots({ windowDays: 7, limit: 10 });

    expect(agg.hotspots).to.have.length(1);
    expect(agg.hotspots[0].suggestedStrategy).to.equal('accessibility id');
  });

  it('suggestedStrategy is null when no heals carried a healed_strategy', async () => {
    sessionLogStub.resolves([
      makeHealRow({
        original_strategy: 'xpath',
        original_selector: 'login-btn',
        healed_strategy: null,
      }),
      makeHealRow({
        original_strategy: 'xpath',
        original_selector: 'login-btn',
        healed_strategy: null,
      }),
    ]);

    const agg = await aggregateHotspots({ windowDays: 7, limit: 10 });

    expect(agg.hotspots).to.have.length(1);
    expect(agg.hotspots[0].suggestedStrategy).to.equal(null);
  });
});
