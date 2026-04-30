import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { metrics, trace } from '@opentelemetry/api';
import { HEALING_METRICS } from '../../src/services/healing/HealingMetrics';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { HealingTier } from '../../src/services/healing/types';
import { METRIC } from '../../src/services/telemetry/attributes';

// Mock instruments captured per `meter.createCounter()` / `createHistogram()`
// call so tests can assert on emissions without standing up a real
// MeterProvider. Keyed by instrument name.
function makeMockMeter() {
  const counters = new Map<string, { add: sinon.SinonSpy }>();
  const histograms = new Map<string, { record: sinon.SinonSpy }>();
  const meter = {
    createCounter: (name: string) => {
      let c = counters.get(name);
      if (!c) {
        c = { add: sinon.spy() };
        counters.set(name, c);
      }
      return c;
    },
    createHistogram: (name: string) => {
      let h = histograms.get(name);
      if (!h) {
        h = { record: sinon.spy() };
        histograms.set(name, h);
      }
      return h;
    },
  } as any;
  return { meter, counters, histograms };
}

function makeMockSpan() {
  return {
    addEvent: sinon.spy(),
    setAttributes: sinon.spy(),
    setStatus: sinon.spy(),
    end: sinon.spy(),
  };
}

describe('HealingOrchestrator instrumentation', () => {
  let getMeterStub: sinon.SinonStub;
  let getTracerStub: sinon.SinonStub;
  let mockSpan: ReturnType<typeof makeMockSpan>;
  let mockMeterCtx: ReturnType<typeof makeMockMeter>;

  beforeEach(() => {
    // Force HEALING_METRICS to re-init OTel instruments against our mock.
    (HEALING_METRICS as any).otelLoaded = false;

    mockMeterCtx = makeMockMeter();
    mockSpan = makeMockSpan();

    getMeterStub = sinon.stub(metrics, 'getMeter').returns(mockMeterCtx.meter);
    getTracerStub = sinon.stub(trace, 'getTracer').returns({
      startSpan: () => mockSpan,
    } as any);
  });

  afterEach(() => {
    getMeterStub.restore();
    getTracerStub.restore();
  });

  function makeDriverWithSource() {
    return {
      getPageSource: async () => '<xml/>',
      getScreenshot: async () => 'AAAA',
    };
  }

  function makeOrchestratorWithProviders(providers: any[]): HealingOrchestrator {
    const orchestrator = new HealingOrchestrator({
      saveSignature: sinon.stub().resolves(),
    } as any);
    (orchestrator as any).providers = providers;
    return orchestrator;
  }

  it('emits attempt + success counters and duration histogram on a tier hit', async () => {
    const provider = {
      name: 'Native',
      tier: HealingTier.TIER_1_NATIVE,
      heal: sinon.stub().resolves({
        id: 'el-1',
        tier: HealingTier.TIER_1_NATIVE,
        confidence: 0.9,
        originalSelector: 's',
        recommendedSelector: 's-healed',
        recommendedStrategy: 'xpath',
      }),
    };
    const orch = makeOrchestratorWithProviders([provider]);

    const result = await orch.attemptHealing('sess-1', makeDriverWithSource(), 'xpath', '//foo');
    expect(result).to.not.equal(null);

    const attempts = mockMeterCtx.counters.get(METRIC.HEALING_ATTEMPTS)!;
    const successes = mockMeterCtx.counters.get(METRIC.HEALING_SUCCESSES)!;
    const duration = mockMeterCtx.histograms.get(METRIC.HEALING_DURATION_MS)!;
    expect(attempts.add.calledOnce).to.equal(true);
    expect(attempts.add.firstCall.args[1]).to.deep.equal({ tier: 'Native' });
    expect(successes.add.calledOnce).to.equal(true);
    expect(duration.record.calledOnce).to.equal(true);
    expect(duration.record.firstCall.args[1]).to.deep.include({ tier: 'Native', outcome: 'success' });
  });

  it('records failure path with attempts + failures counter when all tiers fail', async () => {
    const tier1 = {
      name: 'Native',
      tier: HealingTier.TIER_1_NATIVE,
      heal: sinon.stub().resolves(null),
    };
    const tier2 = {
      name: 'LLM',
      tier: HealingTier.TIER_5_LLM_REASONING,
      heal: sinon.stub().resolves(null),
    };
    const orch = makeOrchestratorWithProviders([tier1, tier2]);

    const result = await orch.attemptHealing('sess-2', makeDriverWithSource(), 'xpath', '//bar');
    expect(result).to.equal(null);

    const attempts = mockMeterCtx.counters.get(METRIC.HEALING_ATTEMPTS)!;
    const failures = mockMeterCtx.counters.get(METRIC.HEALING_FAILURES)!;
    const allFailed = mockMeterCtx.counters.get(METRIC.HEALING_ALL_TIERS_FAILED)!;
    expect(attempts.add.callCount).to.equal(2);
    expect(failures.add.callCount).to.equal(2);
    expect(allFailed.add.calledOnce).to.equal(true);
  });

  it('records tier_skipped counter when a provider short-circuits remaining tiers', async () => {
    const tier1 = {
      name: 'Resilio',
      tier: HealingTier.TIER_1_RECOVERY,
      heal: sinon.stub().resolves(null),
      shouldSkipRemaining: () => true,
    };
    const tier2 = {
      name: 'LLM',
      tier: HealingTier.TIER_5_LLM_REASONING,
      heal: sinon.stub().resolves(null),
    };
    const orch = makeOrchestratorWithProviders([tier1, tier2]);

    await orch.attemptHealing('sess-3', makeDriverWithSource(), 'xpath', '//baz');
    expect(tier2.heal.notCalled).to.equal(true);

    const skipped = mockMeterCtx.counters.get(METRIC.HEALING_TIER_SKIPPED)!;
    expect(skipped.add.calledOnce).to.equal(true);
    expect(skipped.add.firstCall.args[1]).to.deep.equal({ tier: 'Resilio' });
  });

  it('starts and ends a span with outcome attributes on success', async () => {
    const provider = {
      name: 'Fuzzy XML',
      tier: HealingTier.TIER_2_FUZZY_XML,
      heal: sinon.stub().resolves({
        id: 'el-2',
        tier: HealingTier.TIER_2_FUZZY_XML,
        confidence: 0.85,
        originalSelector: 's',
        recommendedSelector: 's-healed',
      }),
    };
    const orch = makeOrchestratorWithProviders([provider]);

    await orch.attemptHealing('sess-4', makeDriverWithSource(), 'xpath', '//qux');

    expect(mockSpan.addEvent.calledWith('tier_started')).to.equal(true);
    expect(mockSpan.addEvent.calledWith('tier_succeeded')).to.equal(true);
    expect(mockSpan.setAttributes.calledOnce).to.equal(true);
    const attrs = mockSpan.setAttributes.firstCall.args[0];
    expect(attrs['xenon.healing.tier']).to.equal('Fuzzy XML');
    expect(attrs['xenon.healing.confidence']).to.equal(0.85);
    expect(mockSpan.end.calledOnce).to.equal(true);
  });

  it('marks span ERROR on all_tiers_failed', async () => {
    const provider = {
      name: 'Native',
      tier: HealingTier.TIER_1_NATIVE,
      heal: sinon.stub().resolves(null),
    };
    const orch = makeOrchestratorWithProviders([provider]);

    await orch.attemptHealing('sess-5', makeDriverWithSource(), 'xpath', '//none');

    expect(mockSpan.addEvent.calledWith('all_tiers_failed')).to.equal(true);
    const statusArg = mockSpan.setStatus.firstCall.args[0];
    expect(statusArg.message).to.equal('all_tiers_failed');
    expect(mockSpan.end.calledOnce).to.equal(true);
  });

  it('marks span ERROR and ends on context-collection failure (driver throws)', async () => {
    const orch = makeOrchestratorWithProviders([]);
    const driver = {
      getPageSource: async () => {
        throw new Error('disconnected');
      },
      getScreenshot: async () => 'AAAA',
    };

    const result = await orch.attemptHealing('sess-6', driver, 'xpath', '//x');
    expect(result).to.equal(null);

    expect(mockSpan.addEvent.calledWith('context_collection_failed')).to.equal(true);
    expect(mockSpan.end.calledOnce).to.equal(true);
  });

  it('does not put the original selector text on span attributes (cardinality discipline)', async () => {
    const provider = {
      name: 'Native',
      tier: HealingTier.TIER_1_NATIVE,
      heal: sinon.stub().resolves({
        id: 'el-3',
        tier: HealingTier.TIER_1_NATIVE,
        confidence: 0.95,
        originalSelector: 's',
        recommendedSelector: 's-healed',
      }),
    };
    const orch = makeOrchestratorWithProviders([provider]);
    const longSelector =
      '//really/long/xpath[@id="not-cardinality-friendly"]/descendant::*[contains(@class,"xx")]';

    await orch.attemptHealing('sess-7', makeDriverWithSource(), 'xpath', longSelector);

    const setAttrCalls = mockSpan.setAttributes.getCalls();
    for (const call of setAttrCalls) {
      const attrs = call.args[0];
      for (const [k, v] of Object.entries(attrs)) {
        expect(String(v)).to.not.include(longSelector);
      }
    }
  });
});
