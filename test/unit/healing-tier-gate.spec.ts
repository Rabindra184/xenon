import { expect } from 'chai';
import { Container } from 'typedi';
import {
  HealingOrchestrator,
  filterProvidersByTier,
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
