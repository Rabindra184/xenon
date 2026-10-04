import { HealingProvider, HealingTier, HealedElement, HealingContext } from './types';
import { Container } from 'typedi';
import log from '../../logger';
import { HealEtalonService } from './HealEtalonService';
import { HealedLocatorGenerator } from './HealedLocatorGenerator';
import { isResilioPath, nearestElement } from './resilioPath';

/**
 * Tier 0: the element at the end of the path most like the one the selector's
 * element had when the selector last worked (resilioPath.ts). It answers only
 * when it is sure, which is when the element kept its identity (Android's
 * resource-id, iOS's name) and moved in the tree: a positional XPath that
 * broke when the layout changed. Anything less is the next tier's to decide.
 */
export class ResilioTreeHealingProvider implements HealingProvider {
  name = 'ResilioTree Provider';
  tier = HealingTier.TIER_1_RECOVERY; // High priority robust recovery
  private logger = log.scope('ResilioTreeHealing');
  private generator: HealedLocatorGenerator;

  constructor(private etalonService: HealEtalonService) {
    this.generator = Container.get(HealedLocatorGenerator);
  }

  async heal(context: HealingContext): Promise<HealedElement | null> {
    if (!context.pageSource) {
      this.logger.debug('No page source available for ResilioTree healing');
      return null;
    }

    try {
      const signature = await this.etalonService.getSignature(context.selector);
      if (!isResilioPath(signature?.path)) {
        this.logger.debug(`No ResilioTree path found for selector: ${context.selector}`);
        return null;
      }

      this.logger.info(`Attempting robust ResilioTree recovery for: ${context.selector}`);
      const nearest = nearestElement(signature!.path, context.pageSource);
      if (!nearest) {
        this.logger.info(`ResilioTree found no element it is sure of for: ${context.selector}`);
        return null;
      }

      // The first of the element's locators the driver finds, as Fuzzy XML does.
      const candidates = this.generator.generate(nearest.element);
      for (const candidate of candidates) {
        try {
          const found = await context.driver.findElement('xpath', candidate);
          const id = found?.ELEMENT || found?.['element-6066-11e4-a52e-4f735466cecf'];
          if (!id) continue;
          this.logger.info(
            `ResilioTree recovered the element (score ${nearest.score.toFixed(2)}): ${candidate}`,
          );
          return {
            id,
            originalSelector: context.selector,
            originalStrategy: context.strategy,
            recommendedSelector: candidate,
            recommendedStrategy: 'xpath',
            candidateSelectors: candidates,
            confidence: nearest.score,
            tier: this.tier,
            node: nearest.element,
            message: `Recovered via ResilioTree path matching. New XPath: ${candidate}`,
          };
        } catch {
          this.logger.debug(`Driver failed to find element suggested by ResilioTree: ${candidate}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error during ResilioTree healing: ${err.message}`);
    }

    return null;
  }
}
