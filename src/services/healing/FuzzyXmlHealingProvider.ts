import { HealingProvider, HealingTier, HealedElement, HealingContext } from './types';
import { DOMParser } from '@xmldom/xmldom';
// @ts-ignore
import { select as xpathQuery } from 'xpath';
import _ from 'lodash';
import { Container } from 'typedi';
import log from '../../logger';
import { HealEtalonService, LocatorSignature } from './HealEtalonService';
import { HealedLocatorGenerator } from './HealedLocatorGenerator';

export class FuzzyXmlHealingProvider implements HealingProvider {
  name = 'Fuzzy XML Provider';
  tier = HealingTier.TIER_2_FUZZY_XML;
  private logger = log.scope('FuzzyXmlHealing');
  private generator: HealedLocatorGenerator;

  constructor(private etalonService?: HealEtalonService) {
    this.generator = Container.get(HealedLocatorGenerator);
  }

  async heal(context: HealingContext): Promise<HealedElement | null> {
    if (!context.pageSource) {
      this.logger.debug('No page source available for fuzzy matching');
      return null;
    }

    try {
      const dom = new DOMParser().parseFromString(context.pageSource, 'text/xml');

      // TIER 2+ Optimization: Use Baseline Signature if available
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
      const nodes = xpathQuery('//*', dom as any) as Element[];

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
        const candidateLocators = this.generator.generate(bestMatch);
        // Also add the absolute XPath as the ultimate fallback
        const absXpath = this.getAbsoluteXpath(bestMatch);
        if (!candidateLocators.includes(absXpath)) {
          candidateLocators.push(absXpath);
        }

        this.logger.info(
          `✅ Found fuzzy match with score ${highestScore.toFixed(2)}. Trying ${candidateLocators.length} candidate locators...`,
        );

        // Try ALL candidate locators until one actually resolves
        for (const candidateXpath of candidateLocators) {
          try {
            this.logger.debug(`  Trying candidate: ${candidateXpath}`);
            const element = await context.driver.findElement('xpath', candidateXpath);
            const elementId = element.ELEMENT || element['element-6066-11e4-a52e-4f735466cecf'];
            if (elementId) {
              this.logger.info(`🎯 Resolved via candidate: ${candidateXpath}`);
              return {
                id: elementId,
                tier: this.tier,
                confidence: highestScore,
                originalSelector: context.selector,
                recommendedSelector: candidateXpath,
                candidateSelectors: candidateLocators,
                node: bestMatch,
                message: `Found element via fuzzy matching (${(highestScore * 100).toFixed(0)}% confidence). Healed locator: ${candidateXpath}`,
              };
            }
          } catch (err) {
            this.logger.debug(`  Candidate failed: ${candidateXpath}`);
          }
        }

        this.logger.warn(
          `All ${candidateLocators.length} candidate locators failed to resolve for fuzzy match.`,
        );
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
      'content-desc': 2.0, // Android
      'resource-id': 1.5, // Android/iOS
      'accessibility-id': 2.0, // iOS
      label: 1.5, // iOS
      name: 1.5, // iOS — elevated: @name is the primary iOS identifier
      id: 1.0, // Android
      hint: 0.4, // Android
      value: 0.5, // iOS
    };

    const nodeAttrs: any = node.attributes || [];
    let totalScore = 0;
    let totalWeight = 0;

    // === CRITICAL GATE: Tag Name Match ===
    // When we have a baseline etalon, we KNOW the exact element type.
    // XCUIElementTypeButton should NEVER match XCUIElementTypeImage or XCUIElementTypeApplication.
    if (etalon) {
      const etalonTag = etalon.nodeName.toLowerCase();
      const nodeTag = node.nodeName.toLowerCase();

      // Exact match required when etalon is present (no fuzzy allowed for tag)
      if (etalonTag !== nodeTag && etalonTag !== 'xcuielementtypeany' && etalonTag !== 'unknown') {
        return 0; // Immediate rejection — wrong element type
      }
      // Tag matches perfectly
      totalWeight += 1.0;
      totalScore += 1.0;
    } else {
      // No etalon: use fuzzy tag matching with keywords
      const tagWeight = 0.5;
      const tagSim = this.getBestSimilarity(node.nodeName, keywords);
      totalWeight += tagWeight;
      totalScore += tagSim * tagWeight;
    }

    // === 2. Semantic Text Matching ===
    // Check text content and text-like attributes against baseline or keywords
    const textWeight = etalon ? 0.5 : 1.0;
    const textTargets = etalon
      ? ([etalon.attributes['text'], etalon.attributes['label'], etalon.attributes['name']].filter(
          Boolean,
        ) as string[])
      : keywords;

    let bestTextSim = 0;
    if (textTargets.length > 0) {
      bestTextSim = this.getBestSimilarity(node.textContent || '', textTargets);

      // Also check text-like attributes: name, label, text, value
      for (const attrName of ['text', 'name', 'label', 'value']) {
        const attrVal = this.getAttrValue(node, attrName);
        if (attrVal) {
          const sim = this.getBestSimilarity(attrVal, textTargets);
          if (sim > bestTextSim) bestTextSim = sim;
        }
      }
    }

    totalWeight += textWeight;
    totalScore += bestTextSim * textWeight;

    // === 3. Anchor Attribute Matching ===
    for (let i = 0; i < nodeAttrs.length; i++) {
      const attr = nodeAttrs[i];
      const attrName = attr.name.toLowerCase();

      // Skip non-anchor, spatial, and already-handled attrs
      if (
        [
          'x',
          'y',
          'width',
          'height',
          'text',
          'type',
          'enabled',
          'visible',
          'accessible',
          'index',
          'traits',
          'processId',
          'bundleId',
        ].includes(attrName)
      )
        continue;

      if (ANCHORS[attrName]) {
        const weight = ANCHORS[attrName];
        const etalonValue = etalon?.attributes[attrName];
        const target = etalonValue ? [etalonValue] : keywords;
        let sim = this.getBestSimilarity(attr.value, target);

        // Exact match with etalon gets perfect score
        if (etalonValue && attr.value === etalonValue) {
          sim = 1.0;
        }

        totalWeight += weight;
        totalScore += sim * weight;
      }
    }

    // === 4. SPATIAL MATCHING: The Decisive Signal ===
    // When the etalon has X/Y coordinates, position is the STRONGEST signal.
    // Elements rarely move on screen; text/names change far more often.
    if (etalon && etalon.attributes['x'] !== undefined) {
      const spatialWeight = 5.0; // Very high — position is king
      let spatialScore = 0;

      const ex = parseInt(etalon.attributes['x']);
      const ey = parseInt(etalon.attributes['y']);

      // Get candidate node coordinates — handle both iOS and Android formats
      let nx = -999;
      let ny = -999;

      // iOS format: separate x, y attributes
      const iosX = this.getAttrValue(node, 'x');
      const iosY = this.getAttrValue(node, 'y');
      if (iosX !== null && iosY !== null) {
        nx = parseInt(iosX);
        ny = parseInt(iosY);
      } else {
        // Android format: bounds="[x1,y1][x2,y2]" — compute top-left (matches getElementRect)
        const bounds = this.getAttrValue(node, 'bounds');
        if (bounds) {
          const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
          if (match) {
            nx = parseInt(match[1]); // x1 (left)
            ny = parseInt(match[2]); // y1 (top)
          }
        }
      }

      if (nx !== -999 && ny !== -999) {
        const dist = Math.sqrt(Math.pow(ex - nx, 2) + Math.pow(ey - ny, 2));
        if (dist < 5) {
          spatialScore = 1.0; // Near-perfect position match
        } else if (dist < 20) {
          spatialScore = 0.85; // Very close
        } else if (dist < 50) {
          spatialScore = 0.5; // Same general area
        } else if (dist < 100) {
          spatialScore = 0.2; // Nearby
        }
        // > 100px: no spatial score
      }

      totalWeight += spatialWeight;
      totalScore += spatialScore * spatialWeight;
    }

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    // Diagnostic logging for debugging
    if (finalScore > 0.3) {
      this.logger.debug(
        `Score [${node.nodeName}]: final=${finalScore.toFixed(2)} ` +
          `(total=${totalScore.toFixed(2)}/${totalWeight.toFixed(1)}) ` +
          `name=${this.getAttrValue(node, 'name') || '-'} ` +
          `label=${this.getAttrValue(node, 'label') || '-'} ` +
          `X=${this.getAttrValue(node, 'x')},Y=${this.getAttrValue(node, 'y')}`,
      );
    }

    return finalScore;
  }

  private getAttrValue(node: Element, name: string): string | null {
    if (typeof node.getAttribute === 'function') {
      const val = node.getAttribute(name);
      if (val) return val;
    }
    const nodeAttrs: any = node.attributes || [];
    for (let i = 0; i < nodeAttrs.length; i++) {
      if (nodeAttrs[i].name.toLowerCase() === name) return nodeAttrs[i].value;
    }
    return null;
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
