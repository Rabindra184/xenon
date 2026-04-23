import { Service } from 'typedi';
import log from '../../logger';
import { HealedElement, HealingContext, HealingProvider } from './types';
import { FuzzyXmlHealingProvider } from './FuzzyXmlHealingProvider';
import { OcrHealingProvider } from './OcrHealingProvider';
import { VisualAiHealingProvider } from './VisualAiHealingProvider';
import { LlmHealingProvider } from './LlmHealingProvider';
import { HealEtalonService } from './HealEtalonService';
import { ResilioTreeHealingProvider } from './ResilioTreeHealingProvider';

@Service()
export class HealingOrchestrator {
  private logger = log.scope('HealingOrchestrator');
  private providers: HealingProvider[] = [];

  constructor(private etalonService: HealEtalonService) {
    this.providers = [
      new ResilioTreeHealingProvider(this.etalonService),
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
    selector: string,
  ): Promise<HealedElement | null> {
    this.logger.info(
      `🚨 Self-Healing triggered for session ${sessionId}. Broken locator: ${strategy}=${selector}`,
    );

    // Preparation: Collect data required for healing
    // Note: We do this once to avoid multiple expensive round-trips
    const context: HealingContext = { sessionId, driver, strategy, selector };

    try {
      this.logger.debug('Collecting page source and screenshot for analysis...');
      const [xml, screenshot] = await Promise.all([driver.getPageSource(), driver.getScreenshot()]);
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
          this.logger.info(
            `✨ Provider ${provider.name} found a match! Confidence: ${(
              result.confidence * 100
            ).toFixed(0)}%`,
          );

          // Tier 1/2 Optimization: Stability Verification Loop
          // We try all candidates to see which one is the most stable (semantic vs absolute)
          if (result.candidateSelectors && result.candidateSelectors.length > 0) {
            this.logger.debug(
              `Verifying ${result.candidateSelectors.length} candidate locators for stability...`,
            );
            for (const candidate of result.candidateSelectors) {
              try {
                const elements = await context.driver.findElements('xpath', candidate);
                if (elements.length === 1) {
                  this.logger.info(`🎯 Verified stable & unique locator: ${candidate}`);
                  result.recommendedSelector = candidate;
                  break; // Found a unique stable locator
                } else if (elements.length > 1) {
                  this.logger.debug(
                    `⚠️ Candidate locator is not unique (${elements.length} matches): ${candidate}`,
                  );
                }
              } catch (e) {
                this.logger.debug(`Candidate locator check failed: ${candidate}`);
              }
            }
          }

          // Principal Learning: Autonomously update the etalon to prevent future failures
          // We only do this if confidence is over 70% to avoid pollution with false positives
          if (result.confidence > 0.7 && result.node) {
            try {
              this.logger.info(`🧠 Learning from healing success: updating etalon for ${selector}`);

              // Recalculate path for ResilioTree if node is available
              let learnedPath: any = null;
              if (result.node) {
                try {
                  const { Path } = await import('resiliotree');
                  const pathNodes: any[] = [];
                  let curr: any = result.node;
                  while (curr) {
                    pathNodes.unshift(curr);
                    curr = curr.parent || curr.parentNode;
                  }
                  learnedPath = new Path(pathNodes).toJSON();
                } catch (e) {}
              }

              await this.etalonService.saveSignature(strategy, selector, result.node, learnedPath);
            } catch (learnErr: any) {
              // Warn (not debug) so the loss of learning shows up in default logs —
              // a silent failure here means the same selector keeps needing the LLM tier.
              this.logger.warn(
                `Etalon save failed after healing [strategy=${strategy}, selector=${selector}, confidence=${result.confidence}]: ${learnErr.message}`,
              );
            }
          }

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
