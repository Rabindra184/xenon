import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import {
  HealingOrchestrator,
  filterProvidersByTier,
  coerceHealingTiersCap,
  healingTiersFromCaps,
} from '../../src/services/healing/HealingOrchestrator';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { HealedLocatorGenerator } from '../../src/services/healing/HealedLocatorGenerator';
import { HealingProvider, HealingTier } from '../../src/services/healing/types';
import { saveRegistrations } from '../helpers/container-registration';

// §2.7 healing-tier capability gate: xe:options.healingTiers restricts which
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

  // The value is a privacy control: a session that leaves out Visual AI (4)
  // and the LLM (5) keeps its screen away from the AI provider. So a value
  // that can't be read fails closed for those two, and open for the rest:
  // the tiers that stay on the server (1, 2, 3) still run. Through 2.14 an
  // empty list, or a value that wasn't a list or had no numbers in it, ran
  // every tier, the AI ones included; a list that held some numbers ran those.
  describe('coerceHealingTiersCap', () => {
    it('passes a list of tier numbers through unchanged', () => {
      expect(coerceHealingTiersCap([1, 3])).to.deep.equal([1, 3]);
      expect(coerceHealingTiersCap([5, 4, 1])).to.deep.equal([5, 4, 1]);
    });

    it('runs every tier when the session sets nothing', () => {
      expect(coerceHealingTiersCap(undefined)).to.equal(undefined);
      expect(coerceHealingTiersCap(null)).to.equal(undefined);
    });

    it('runs no tier for an empty list', () => {
      expect(coerceHealingTiersCap([])).to.deep.equal([]);
    });

    for (const [label, value] of [
      ['a string', '1,2'],
      ['numbers as strings', ['1', '2']],
      ['a list with a string in it', [1, '2']],
      ['a number that is no tier', [1, 6]],
      ['tier 0', [0]],
      ['a fraction', [1.5]],
      ['a lone number', 4],
      ['an object', { llm: false }],
      ['true', true],
    ] as const) {
      it(`runs only the tiers that stay on the server for ${label}`, () => {
        expect(coerceHealingTiersCap(value)).to.deep.equal([1, 2, 3]);
        expect(filterProvidersByTier(providers, coerceHealingTiersCap(value))).to.deep.equal(
          providers.slice(0, 3),
        );
      });
    }
  });

  // What CommandInterceptor hands attemptHealing, read from the session's
  // capabilities.
  describe('healingTiersFromCaps', () => {
    it('reads xe:options.healingTiers', () => {
      expect(healingTiersFromCaps({ 'xe:options': { healingTiers: [1, 2] } })).to.deep.equal({
        tiers: [1, 2],
      });
    });

    it('still reads the xenon:options alias', () => {
      expect(healingTiersFromCaps({ 'xenon:options': { healingTiers: [3] } })).to.deep.equal({
        tiers: [3],
      });
    });

    it('prefers xe:options when both set it', () => {
      expect(
        healingTiersFromCaps({
          'xenon:options': { healingTiers: [5] },
          'xe:options': { healingTiers: [1] },
        }),
      ).to.deep.equal({ tiers: [1] });
    });

    it('runs every tier with no capabilities, or none set', () => {
      expect(healingTiersFromCaps(undefined)).to.deep.equal({ tiers: undefined });
      expect(healingTiersFromCaps({})).to.deep.equal({ tiers: undefined });
      expect(healingTiersFromCaps({ 'xe:options': {} })).to.deep.equal({ tiers: undefined });
    });

    it('names a value it could not read, for the log', () => {
      expect(healingTiersFromCaps({ 'xe:options': { healingTiers: ['1'] } })).to.deep.equal({
        tiers: [1, 2, 3],
        unreadable: 'healingTiers is ["1"], not a list of tier numbers from 1 to 5',
      });
    });

    // xenonOptionsIn skips a namespace that isn't an object, so this one used
    // to read as "nothing set", and ran every tier.
    it('runs only the tiers that stay on the server when xe:options is not an object', () => {
      expect(healingTiersFromCaps({ 'xe:options': '{"healingTiers":[1]}' })).to.deep.equal({
        tiers: [1, 2, 3],
        unreadable: 'xe:options is "{\\"healingTiers\\":[1]}", not an object',
      });
      expect(
        healingTiersFromCaps({
          'xenon:options': ['healingTiers'],
          'xe:options': { healingTiers: [1, 2, 3, 4, 5] },
        }),
      ).to.deep.equal({
        tiers: [1, 2, 3],
        unreadable: 'xenon:options is ["healingTiers"], not an object',
      });
    });
  });
});

describe('HealingOrchestrator.attemptHealing allowedTiers dispatch gate', () => {
  let orchestrator: HealingOrchestrator;
  let mockEtalonService: any;
  const dispatched: string[] = [];
  let restoreContainer: () => void;

  beforeEach(() => {
    restoreContainer = saveRegistrations(HealEtalonService, HealedLocatorGenerator);
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

  afterEach(() => restoreContainer());

  const mockDriver = {
    getPageSource: async () => '<xml/>',
    getScreenshot: async () => 'fake-screenshot',
    findElements: async () => [],
  };

  it('only dispatches to the provider(s) whose tier is in allowedTiers', async () => {
    await orchestrator.attemptHealing('sess-1', mockDriver, 'xpath', '//broken', [1]);
    expect(dispatched).to.deep.equal(['ResilioTree Provider']);
  });

  it('collects nothing and dispatches nothing when no tier is allowed', async () => {
    let collected = 0;
    const driver = {
      ...mockDriver,
      getPageSource: async () => {
        collected++;
        return '<xml/>';
      },
      getScreenshot: async () => {
        collected++;
        return 'fake-screenshot';
      },
    };
    const healed = await orchestrator.attemptHealing('sess-3', driver, 'xpath', '//broken', []);
    expect(healed).to.equal(null);
    expect(dispatched).to.deep.equal([]);
    expect(collected).to.equal(0);
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
