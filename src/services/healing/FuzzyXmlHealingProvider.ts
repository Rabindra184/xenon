import { HealingProvider, HealingTier, HealedElement, HealingContext } from './types';
// @ts-ignore
import { DOMParser } from 'xmldom';
// @ts-ignore
import { select as xpathQuery } from 'xpath';
import _ from 'lodash';
import log from '../../logger';
import { HealEtalonService, LocatorSignature } from './HealEtalonService';

export class FuzzyXmlHealingProvider implements HealingProvider {
  name = 'Fuzzy XML Provider';
  tier = HealingTier.TIER_2_FUZZY_XML;
  private logger = log.scope('FuzzyXmlHealing');

  constructor(private etalonService?: HealEtalonService) {}

  async heal(context: HealingContext): Promise<HealedElement | null> {
    if (!context.pageSource) {
      this.logger.debug('No page source available for fuzzy matching');
      return null;
    }

    try {
      const dom = new DOMParser().parseFromString(context.pageSource);

      // TIER 2+ Optimization: Use Baseline Signature if available (Healenium standard)
      let etalon: LocatorSignature | null = null;
      if (this.etalonService) {
        etalon = await this.etalonService.getSignature(context.selector);
      }

      const keywords = this.extractKeywords(context.selector);
      if (keywords.length === 0 && !etalon) return null;

      if (etalon) {
        this.logger.info('Baseline signature found for locator. Using weighted recovery...');
      } else {
        this.logger.info(
          `No baseline found. Attempting fuzzy match for keywords: ${keywords.join(', ')}`,
        );
      }

      // Find all elements with text or attributes matching keywords or etalon
      const nodes = xpathQuery('//*', dom) as Element[];

      let bestMatch: Element | null = null;
      let highestScore = 0;

      for (const node of nodes) {
        const score = this.calculateScore(node, keywords, etalon);
        if (score > highestScore && score > 0.5) {
          // Threshold 50% for POC robustness
          highestScore = score;
          bestMatch = node;
        }
      }

      if (bestMatch) {
        const recommendedXpath = this.getAbsoluteXpath(bestMatch);
        this.logger.info(
          `✅ Found fuzzy match with score ${highestScore.toFixed(2)}: ${recommendedXpath}`,
        );

        // Note: For Appium, we need to return an actual element ID.
        // Since we are in the middle of a command handle, we might need to find it via standard find
        try {
          const element = await context.driver.findElement('xpath', recommendedXpath);
          return {
            id: element.ELEMENT || element['element-6066-11e4-a52e-4f735466cecf'],
            tier: this.tier,
            confidence: highestScore,
            originalSelector: context.selector,
            recommendedSelector: recommendedXpath,
            message: `Found element via fuzzy attribute matching (${(highestScore * 100).toFixed(0)}% confidence)`,
          };
        } catch (err) {
          this.logger.error('Failed to resolve healed element on device');
        }
      }
    } catch (err: any) {
      this.logger.error(`Error during fuzzy healing: ${err.message}`);
    }

    return null;
  }

  private extractKeywords(selector: string): string[] {
    // Extract words from selector, ignoring XPath syntax and common keywords
    const blacklist = ['and', 'or', 'text', 'contains', 'xpath', 'element'];
    const cleaned = selector.replace(/[\/\@\[\]\=\'\"]/g, ' ');
    return cleaned.split(/\s+/).filter((s) => s.length > 2 && !blacklist.includes(s.toLowerCase()));
  }

  private calculateScore(
    node: Element,
    keywords: string[],
    etalon: LocatorSignature | null = null,
  ): number {
    const ANCHORS: Record<string, number> = {
      'content-desc': 2.0, // Highest stability in Appium
      'resource-id': 1.5, // High stability
      name: 1.0, // Moderate stability
      id: 1.0, // Moderate stability
      hint: 0.4, // Low stability
    };

    const nodeAttrs: any = node.attributes || [];
    let totalScore = 0;
    let totalWeight = 0;

    // 1. Tag name similarity
    const tagWeight = 0.2;
    const tagTarget = etalon ? [etalon.nodeName] : keywords;
    const tagSim = this.getBestSimilarity(node.nodeName, tagTarget);
    totalWeight += tagWeight;
    totalScore += tagSim * tagWeight;

    // 2. Semantic Text: Combine textContent and text attribute
    // Lower weight for text when etalon is present as it's more volatile than anchors
    const textWeight = etalon ? 0.5 : 1.0;
    const textTarget = etalon
      ? etalon.attributes['text']
        ? [etalon.attributes['text']]
        : keywords
      : keywords;
    let bestTextSim = this.getBestSimilarity(node.textContent || '', textTarget);

    // Check if there is a 'text' attribute and use the best value
    for (let i = 0; i < nodeAttrs.length; i++) {
      if (nodeAttrs[i].name.toLowerCase() === 'text') {
        const attrTextSim = this.getBestSimilarity(nodeAttrs[i].value, textTarget);
        if (attrTextSim > bestTextSim) bestTextSim = attrTextSim;
      }
    }

    totalWeight += textWeight;
    totalScore += bestTextSim * textWeight;

    // 3. Other Attribute similarity
    for (let i = 0; i < nodeAttrs.length; i++) {
      const attr = nodeAttrs[i];
      const attrName = attr.name.toLowerCase();
      if (attrName === 'text') continue; // already handled

      if (ANCHORS[attrName]) {
        const weight = ANCHORS[attrName];
        const etalonValue = etalon?.attributes[attrName];
        const target = etalonValue ? [etalonValue] : keywords;
        let sim = this.getBestSimilarity(attr.value, target);

        // Industrial Bonus: Exact match with etalon baseline gets a boost
        if (etalonValue && attr.value === etalonValue) {
          sim = 1.0;
        }

        totalWeight += weight;
        totalScore += sim * weight;
      } else {
        const sim = this.getBestSimilarity(attr.value, keywords);
        if (sim > 0.6) {
          const bonusWeight = 0.2;
          totalWeight += bonusWeight;
          totalScore += sim * bonusWeight;
        }
      }
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  private getBestSimilarity(value: string, keywords: string[]): number {
    const lowerValue = (value || '').toLowerCase().trim();
    if (!lowerValue) return 0;

    let best = 0;
    for (const word of keywords) {
      const lowerWord = word.toLowerCase().trim();
      const sim = this.stringSimilarity(lowerValue, lowerWord);
      if (sim > best) best = sim;

      // Bonus for exact containment or very high similarity
      if (lowerValue.includes(lowerWord) && best < 0.7) best = 0.7;
    }
    return best;
  }

  private stringSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    if (s1 === s2) return 1;
    // Simple overlap for very short strings
    if (s1.length < 2 || s2.length < 2) return s1.includes(s2) || s2.includes(s1) ? 0.7 : 0;

    const bigrams1 = new Set();
    for (let i = 0; i < s1.length - 1; i++) bigrams1.add(s1.substring(i, i + 2));

    const bigrams2 = new Set();
    for (let i = 0; i < s2.length - 1; i++) bigrams2.add(s2.substring(i, i + 2));

    let intersection = 0;
    for (const b of bigrams1) {
      if (bigrams2.has(b)) intersection++;
    }

    return (2 * intersection) / (bigrams1.size + bigrams2.size);
  }

  private getAbsoluteXpath(node: Element): string {
    const parts: string[] = [];
    let current: any = node;
    while (current && current.nodeType === 1) {
      // Node.ELEMENT_NODE
      let index = 0;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      const tagName = current.nodeName;
      const pathIndex = index > 0 ? `[${index + 1}]` : '';
      parts.unshift(`${tagName}${pathIndex}`);
      current = current.parentNode;
    }
    return `/${parts.join('/')}`;
  }
}
