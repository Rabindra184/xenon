import { HealingProvider, HealingTier, HealedElement, HealingContext } from './types';
import { AI_SERVICE } from '../AIService';
import log from '../../logger';

export class VisualAiHealingProvider implements HealingProvider {
  name = 'Visual AI Provider';
  tier = HealingTier.TIER_4_VISUAL_AI;
  private logger = log.scope('VisualAiHealing');

  async heal(context: HealingContext): Promise<HealedElement | null> {
    if (!context.screenshotBase64) {
      this.logger.debug('No screenshot available for visual AI matching');
      return null;
    }

    // Check if AI service is enabled before attempting
    if (!AI_SERVICE.isEnabled()) {
      this.logger.debug('AI service not enabled, skipping Visual AI healing');
      return null;
    }

    try {
      // Describe what we are looking for based on the selector
      const description = this.generateVisualDescription(context.selector);
      this.logger.info(`Attempting Visual AI find for: "${description}"`);

      const coordinates = await AI_SERVICE.visualFind(context.screenshotBase64, description);

      if (coordinates && typeof coordinates.x === 'number' && typeof coordinates.y === 'number') {
        this.logger.info(`✅ Visual AI found element at (${coordinates.x}, ${coordinates.y})`);

        return {
          id: `healed_visual_${Date.now()}`,
          tier: this.tier,
          confidence: 0.8, // Basic vision models don't always give confidence, assuming high if found
          originalSelector: context.selector,
          recommendedSelector: `visual:description="${description}"`,
          message: `Found element visually via AI Vision (${description})`,
          rect: {
            x: coordinates.x - 20, // Approximate bounding box
            y: coordinates.y - 20,
            width: 40,
            height: 40,
          },
        };
      }
    } catch (err: any) {
      // Log service unavailability at debug level (expected), other errors at warn level
      if (err.message?.includes('unavailable') || err.message?.includes('404')) {
        this.logger.debug(`Visual AI healing skipped: ${err.message}`);
      } else {
        this.logger.warn(`Error during Visual AI healing: ${err.message}`);
      }
    }

    return null;
  }

  private generateVisualDescription(selector: string): string {
    // Convert selector to a descriptive string for the AI
    // Handle iOS (@name, @label) and Android (@text, @content-desc) patterns
    const textMatch =
      selector.match(/text=['"]([^'"]+)['"]/i) ||
      selector.match(/label=['"]([^'"]+)['"]/i) ||
      selector.match(/name=['"]([^'"]+)['"]/i) ||
      selector.match(/content-desc=['"]([^'"]+)['"]/i);
    if (textMatch) {
      return `the element with text "${textMatch[1]}"`;
    }

    // Clean up IDs
    const idMatch =
      selector.match(/id=['"]([^'"]+)['"]/i) || selector.match(/resource-id=['"]([^'"]+)['"]/i);
    if (idMatch) {
      return `the element with ID or identifier "${idMatch[1]}"`;
    }

    return `the element described by the locator "${selector}"`;
  }
}
