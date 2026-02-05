import { Service } from 'typedi';
import log from '../../logger';
import { HealedElement, HealingContext, HealingProvider } from './types';
import { FuzzyXmlHealingProvider } from './FuzzyXmlHealingProvider';
import { OcrHealingProvider } from './OcrHealingProvider';
import { VisualAiHealingProvider } from './VisualAiHealingProvider';
import { LlmHealingProvider } from './LlmHealingProvider';
import { HealEtalonService } from './HealEtalonService';

@Service()
export class HealingOrchestrator {
    private logger = log.scope('HealingOrchestrator');
    private providers: HealingProvider[] = [];

    constructor(private etalonService: HealEtalonService) {
        this.providers = [
            new FuzzyXmlHealingProvider(this.etalonService),
            new OcrHealingProvider(),
            new VisualAiHealingProvider(),
            new LlmHealingProvider(),
        ];
    }

    async attemptHealing(
        sessionId: string,
        driver: any,
        strategy: string,
        selector: string
    ): Promise<HealedElement | null> {
        this.logger.info(`🚨 Self-Healing triggered for session ${sessionId}. Broken locator: ${strategy}=${selector}`);

        // Preparation: Collect data required for healing
        // Note: We do this once to avoid multiple expensive round-trips
        let context: HealingContext = { sessionId, driver, strategy, selector };

        try {
            this.logger.debug('Collecting page source and screenshot for analysis...');
            const [xml, screenshot] = await Promise.all([
                driver.getPageSource(),
                driver.getScreenshot()
            ]);
            context.pageSource = xml;
            context.screenshotBase64 = screenshot;
        } catch (err: any) {
            this.logger.error(`Failed to collect healing context: ${err.message}`);
            return null;
        }

        // Tiered Execution: Try providers in order of cost/complexity
        for (const provider of this.providers) {
            try {
                this.logger.info(`Attempting Tier ${provider.tier}: ${provider.name}...`);
                const result = await provider.heal(context);

                if (result) {
                    this.logger.info(`✨ Successfully healed using ${provider.name}! Confidence: ${(result.confidence * 100).toFixed(0)}%`);
                    return result;
                }
            } catch (err: any) {
                this.logger.error(`Provider ${provider.name} failed: ${err.message}`);
            }
        }

        this.logger.warn(`❌ All healing tiers failed for selector: ${selector}`);
        return null;
    }
}
