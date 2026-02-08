import { HealingProvider, HealingTier, HealedElement, HealingContext } from './types';
const { Path, PathFinder, JSDOMParser, LCSPathDistance, HeuristicNodeDistance } = require('resiliotree');
import log from '../../logger';
import { HealEtalonService } from './HealEtalonService';

export class ResilioTreeHealingProvider implements HealingProvider {
    name = 'ResilioTree Provider';
    tier = HealingTier.TIER_1_RECOVERY; // High priority robust recovery
    private logger = log.scope('ResilioTreeHealing');

    constructor(private etalonService: HealEtalonService) { }

    async heal(context: HealingContext): Promise<HealedElement | null> {
        if (!context.pageSource) {
            this.logger.debug('No page source available for ResilioTree healing');
            return null;
        }

        try {
            const signature = await this.etalonService.getSignature(context.selector);
            if (!signature || !signature.path) {
                this.logger.debug(`No ResilioTree path found for selector: ${context.selector}`);
                return null;
            }

            this.logger.info(`Attempting robust ResilioTree recovery for: ${context.selector}`);

            // 1. Parse current page source into ResilioTree model
            const parser = new JSDOMParser();
            const targetRoot = parser.parse(context.pageSource);

            // 2. Revive the saved path from JSON
            const savedPath = Path.fromJSON(signature.path);

            // 3. Find the nearest node using ResilioTree's PathFinder
            const pathDistance = new LCSPathDistance();
            const nodeDistance = new HeuristicNodeDistance();
            const pathFinder = new PathFinder(pathDistance, nodeDistance);
            const nearestNode = pathFinder.findNearest(savedPath, targetRoot);

            if (nearestNode) {
                const recommendedXpath = this.generateXpath(nearestNode);
                this.logger.info(`ResilioTree suggested recovery XPath: ${recommendedXpath}`);

                try {
                    const healedElement = await context.driver.findElement('xpath', recommendedXpath);
                    if (healedElement) {
                        return {
                            id: healedElement.ELEMENT || healedElement['element-6066-11e4-a52e-4f735466cecf'],
                            originalSelector: context.selector,
                            recommendedSelector: recommendedXpath,
                            confidence: 0.9, // ResilioTree path matching is high confidence
                            tier: this.tier,
                            message: `Recovered via ResilioTree path matching. New XPath: ${recommendedXpath}`
                        };
                    }
                } catch (e) {
                    this.logger.debug(`Driver failed to find element suggested by ResilioTree: ${recommendedXpath}`);
                }
            }
        } catch (err: any) {
            this.logger.error(`Error during ResilioTree healing: ${err.message}`);
        }

        return null;
    }

    /**
     * Generates an absolute XPath for a ResilioTree Node
     */
    private generateXpath(node: any): string {
        const parts: string[] = [];
        let curr: any = node;
        while (curr) {
            const tag = curr.tag.toLowerCase();
            // Skip JSDOM added wrapper tags for mobile compatibility
            if (tag !== 'html' && tag !== 'body') {
                const index = curr.index + 1; // XPath is 1-based
                parts.unshift(`${curr.tag}[${index}]`);
            }
            curr = curr.parent;
        }
        return `/${parts.join('/')}`;
    }
}
