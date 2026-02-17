import { expect } from 'chai';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { HealingTier } from '../../src/services/healing/types';
import { Container } from 'typedi';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { FuzzyXmlHealingProvider } from '../../src/services/healing/FuzzyXmlHealingProvider';
import { OcrHealingProvider } from '../../src/services/healing/OcrHealingProvider';
import { HealedLocatorGenerator } from '../../src/services/healing/HealedLocatorGenerator';

// Mock Tesseract
const TesseractMock = {
    recognize: async () => ({
        data: {
            words: [
                {
                    text: 'Login',
                    confidence: 90,
                    bbox: { x0: 100, y0: 100, x1: 200, y1: 150 }
                }
            ]
        }
    })
};

// We need to override the import or the class behavior for the test
// Since OcrHealingProvider imports Tesseract directly, we'll mock the heal method for this specific test
// to avoid complex dependency mocking of tesseract.js in a POC environment.

describe('Healing Orchestrator - Cascade Strategy', () => {
    let orchestrator: HealingOrchestrator;
    let mockEtalonService: any;
    let mockGenerator: any;

    beforeEach(() => {
        Container.reset();

        mockEtalonService = {
            getSignature: async () => null,
            saveSignature: async () => { },
        };

        mockGenerator = new HealedLocatorGenerator();
        Container.set(HealEtalonService, mockEtalonService);
        Container.set(HealedLocatorGenerator, mockGenerator);

        orchestrator = new HealingOrchestrator(mockEtalonService as HealEtalonService);
    });

    it('should cascade to OCR (Tier 3) when Fuzzy XML (Tier 2) fails to find a high-confidence match', async () => {
        // 1. Setup a page source that has NO matching text or buttons for "Login"
        // This will cause Fuzzy XML Provider to return null (or score below 0.5 threshold)
        const emptyPageSource = `<?xml version="1.0" encoding="UTF-8"?><AppiumAUT><XCUIElementTypeWindow /></AppiumAUT>`;

        // 2. Setup a screenshot (dummy base64)
        const dummyScreenshot = 'fake-base64-screenshot';

        const mockDriver = {
            getPageSource: async () => emptyPageSource,
            getScreenshot: async () => dummyScreenshot,
            findElements: async () => [],
            findElement: async (strategy: string, selector: string) => {
                // If called via OCR tap-resolution predicate:
                if (strategy === '-ios predicate string' && selector.includes('Login')) {
                    return { ELEMENT: 'real-element-from-ocr' };
                }
                throw new Error('no such element');
            },
        };

        // 3. Mock the OcrHealingProvider behavior for this test to avoid Tesseract native issues
        // We'll replace the OCR provider in the orchestrator with a mock one that succeeds
        const ocrProvider = (orchestrator as any).providers.find((p: any) => p.tier === HealingTier.TIER_3_LOCAL_OCR);

        ocrProvider.heal = async (context: any) => {
            if (context.selector.includes('Login')) {
                return {
                    id: 'healed-via-ocr',
                    tier: HealingTier.TIER_3_LOCAL_OCR,
                    confidence: 0.9,
                    originalSelector: context.selector,
                    recommendedSelector: 'ocr:text="Login"',
                    rect: { x: 100, y: 100, width: 100, height: 50 }
                };
            }
            return null;
        };

        // 4. Trigger healing for a broken "Login" button
        const result = await orchestrator.attemptHealing(
            'test-session',
            mockDriver,
            'xpath',
            "//XCUIElementTypeButton[@name='Login']"
        );

        // 5. Verification
        expect(result).to.not.be.null;
        expect(result?.tier).to.equal(HealingTier.TIER_3_LOCAL_OCR);
        expect(result?.id).to.equal('healed-via-ocr');
        console.log(`    ✓ Cascaed successful! Fuzzy XML failed, but OCR found the element: ${result?.message || 'OCR result'}`);
    });

    it('should continue to LLM Reasoning (Tier 5) if all preceding tiers fail', async () => {
        const emptyPageSource = `<?xml version="1.0" encoding="UTF-8"?><AppiumAUT><XCUIElementTypeWindow /></AppiumAUT>`;

        const mockDriver = {
            getPageSource: async () => emptyPageSource,
            getScreenshot: async () => 'fake-screenshot',
            findElement: async (strategy: string, selector: string) => {
                if (selector === '//llm-healed') return { ELEMENT: 'llm-element' };
                throw new Error('not found');
            }
        };

        // Mock ALL providers before LLM to return null
        (orchestrator as any).providers.forEach((p: any) => {
            if (p.tier < HealingTier.TIER_5_LLM_REASONING) {
                p.heal = async () => null;
            } else {
                // Tier 5 Mock
                p.heal = async () => ({
                    id: 'llm-element',
                    tier: HealingTier.TIER_5_LLM_REASONING,
                    confidence: 0.95,
                    originalSelector: '//broken',
                    recommendedSelector: '//llm-healed'
                });
            }
        });

        const result = await orchestrator.attemptHealing(
            'test-session',
            mockDriver,
            'xpath',
            '//broken'
        );

        expect(result?.tier).to.equal(HealingTier.TIER_5_LLM_REASONING);
        expect(result?.id).to.equal('llm-element');
        console.log('    ✓ Cascade reached Tier 5 (LLM) correctly');
    });
});
