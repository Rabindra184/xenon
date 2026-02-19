import { HealingProvider, HealingTier, HealedElement, HealingContext } from './types';
import { AI_SERVICE } from '../AIService';
import log from '../../logger';

export class LlmHealingProvider implements HealingProvider {
  name = 'LLM Reasoning Provider';
  tier = HealingTier.TIER_5_LLM_REASONING;
  private logger = log.scope('LlmHealing');

  async heal(context: HealingContext): Promise<HealedElement | null> {
    if (!context.pageSource) {
      this.logger.debug('No page source available for LLM reasoning');
      return null;
    }

    // Check if AI service is enabled before attempting
    if (!AI_SERVICE.isEnabled()) {
      this.logger.debug('AI service not enabled, skipping LLM healing');
      return null;
    }

    try {
      this.logger.info(`Attempting Deep LLM healing for locator: "${context.selector}"`);

      const healingResult = await AI_SERVICE.healLocator({
        selector: context.selector,
        strategy: context.strategy,
        xml: context.pageSource,
        screenshotBase64: context.screenshotBase64,
      });

      if (healingResult && healingResult.recommendedXpath) {
        this.logger.info(`✅ LLM found healing path: ${healingResult.recommendedXpath}`);

        // Try to resolve the element to ensure it exists
        try {
          const element = await context.driver.findElement('xpath', healingResult.recommendedXpath);
          return {
            id: element.ELEMENT || element['element-6066-11e4-a52e-4f735466cecf'],
            tier: this.tier,
            confidence: 0.95, // Deep reasoning is typically highly accurate
            originalSelector: context.selector,
            recommendedSelector: healingResult.recommendedXpath,
            message: `Found alternative element via Deep AI Reasoning: ${healingResult.reason}`,
          };
        } catch (err) {
          this.logger.error('LLM recommended path failed to resolve on device');
        }
      }
    } catch (err: any) {
      // Log service unavailability at debug level (expected), other errors at warn level
      if (err.message?.includes('unavailable') || err.message?.includes('404')) {
        this.logger.debug(`LLM healing skipped: ${err.message}`);
      } else {
        this.logger.warn(`Error during LLM healing: ${err.message}`);
      }
    }

    return null;
  }
}
