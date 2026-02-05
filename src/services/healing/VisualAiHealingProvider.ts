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
                        height: 40
                    }
                };
            }

        } catch (err: any) {
            this.logger.error(`Error during Visual AI healing: ${err.message}`);
        }

        return null;
    }

    private generateVisualDescription(selector: string): string {
        // Convert selector to a descriptive string for the AI
        // e.g. //*[@text='Login'] -> "The button with text 'Login'"
        if (selector.includes('text=')) {
            const match = selector.match(/text=['"]([^'"]+)['"]/i);
            return `the element with text "${match ? match[1] : selector}"`;
        }

        // Clean up IDs
        const idMatch = selector.match(/id=['"]([^'"]+)['"]/i) || selector.match(/resource-id=['"]([^'"]+)['"]/i);
        if (idMatch) {
            return `the element with ID or identifier "${idMatch[1]}"`;
        }

        return `the element described by the locator "${selector}"`;
    }
}
