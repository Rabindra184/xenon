import { expect } from 'chai';
import { Container } from 'typedi';
import {
  HealingOrchestrator,
  filterProvidersByTier,
  coerceHealingTiersCap,
} from '../../src/services/healing/HealingOrchestrator';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { HealedLocatorGenerator } from '../../src/services/healing/HealedLocatorGenerator';
import { HealingProvider, HealingTier } from '../../src/services/healing/types';

// §2.7 healing-tier capability gate: xenon:options.healingTiers restricts which
// self-healing providers may be dispatched. Tier index mapping used by the gate
// (array-position based, NOT the internal HealingTier enum): 1=Resilio,
// 2=Fuzzy XML, 3=OCR, 4=Visual AI, 5=LLM (index i -> tier i+1). Tier 0 (native
// selector) is implicit/un-healed and never appears in the providers array.
describe('filterProvidersByTier (§2.7 healing-tier gate)', () => {
  const makeProvider = (name: string): HealingProvider =>
    ({
      name,
      tier: HealingTier.TIER_1_RECOVERY,
      heal: async () => null,
    }) as HealingProvider;

  const providers = [
    makeProvider('Resilio'), // index 0 -> tier 1
    makeProvider('FuzzyXml'), // index 1 -> tier 2
    makeProvider('Ocr'), // index 2 -> tier 3
    makeProvider('VisualAi'), // index 3 -> tier 4
    makeProvider('Llm'), // index 4 -> tier 5
  ];

  it('returns only the provider matching a single allowed tier', () => {
    const result = filterProvidersByTier(providers, [1]);
    expect(result.map((p) => p.name)).to.deep.equal(['Resilio']);
  });

  it('returns providers matching multiple allowed tiers, preserving order', () => {
    const result = filterProvidersByTier(providers, [2, 4]);
    expect(result.map((p) => p.name)).to.deep.equal(['FuzzyXml', 'VisualAi']);
  });

  it('returns all providers when allowedTiers is undefined', () => {
    const result = filterProvidersByTier(providers, undefined);
    expect(result).to.deep.equal(providers);
  });

  it('returns no providers when allowedTiers is an empty array', () => {
    const result = filterProvidersByTier(providers, []);
    expect(result).to.deep.equal([]);
  });

  // MINOR fix (Phase 2a review): the capability accessor must fail OPEN on a
  // malformed healingTiers cap. Pre-fix, an all-non-numeric array (e.g.
  // ["1","2"]) filtered to [] and silently DISABLED healing; the contract is
  // malformed → run all tiers. The cap is meant to RESTRICT healing, never to
  // disable it — so an explicitly-empty [] also coerces to run-all (opting out
  // of healing entirely is not a supported use case).
  describe('coerceHealingTiersCap (malformed cap → fail open)', () => {
    it('passes a numeric array through unchanged', () => {
      expect(coerceHealingTiersCap([1, 3])).to.deep.equal([1, 3]);
    });

    it('keeps only the numeric entries of a mixed array', () => {
      expect(coerceHealingTiersCap([1, '2'])).to.deep.equal([1]);
    });

    it('non-array (string/undefined/null) → undefined (run all)', () => {
      expect(coerceHealingTiersCap('1,2')).to.equal(undefined);
      expect(coerceHealingTiersCap(undefined)).to.equal(undefined);
      expect(coerceHealingTiersCap(null)).to.equal(undefined);
    });

    it('all-non-numeric array ["1","2"] → undefined → ALL providers run (fail open)', () => {
      const coerced = coerceHealingTiersCap(['1', '2']);
      expect(coerced).to.equal(undefined);
      expect(filterProvidersByTier(providers, coerced)).to.deep.equal(providers);
    });

    it('explicitly-empty [] also → undefined (run all; the cap restricts, it cannot disable)', () => {
      expect(coerceHealingTiersCap([])).to.equal(undefined);
    });
  });
});

describe('HealingOrchestrator.attemptHealing allowedTiers dispatch gate', () => {
  let orchestrator: HealingOrchestrator;
  let mockEtalonService: any;
  const dispatched: string[] = [];

  beforeEach(() => {
    Container.reset();
    dispatched.length = 0;

    mockEtalonService = {
      getSignature: async () => null,
      saveSignature: async () => {},
    };
    Container.set(HealEtalonService, mockEtalonService);
    Container.set(HealedLocatorGenerator, new HealedLocatorGenerator());

    orchestrator = new HealingOrchestrator(mockEtalonService as HealEtalonService);

    // Stub every provider to record dispatch and fail, so we can observe
    // exactly which tiers were attempted without needing real provider deps.
    (orchestrator as any).providers.forEach((p: any) => {
      p.heal = async () => {
        dispatched.push(p.name);
        return null;
      };
    });
  });

  const mockDriver = {
    getPageSource: async () => '<xml/>',
    getScreenshot: async () => 'fake-screenshot',
    findElements: async () => [],
  };

  it('only dispatches to the provider(s) whose tier is in allowedTiers', async () => {
    await orchestrator.attemptHealing('sess-1', mockDriver, 'xpath', '//broken', [1]);
    expect(dispatched).to.deep.equal(['ResilioTree Provider']);
  });

  it('dispatches to the full provider set when allowedTiers is omitted (regression)', async () => {
    await orchestrator.attemptHealing('sess-2', mockDriver, 'xpath', '//broken');
    expect(dispatched).to.deep.equal([
      'ResilioTree Provider',
      'Fuzzy XML Provider',
      'OCR Text Provider',
      'Visual AI Provider',
      'LLM Reasoning Provider',
    ]);
  });
});
