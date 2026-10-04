import { HealingProvider, HealingTier, HealedElement, HealingContext } from './types';
import { Container } from 'typedi';
import log from '../../logger';
import { OmniVisionService } from '../omni-vision/OmniVisionService';

export class OcrHealingProvider implements HealingProvider {
  name = 'OCR Text Provider';
  tier = HealingTier.TIER_3_LOCAL_OCR;
  private logger = log.scope('OcrHealing');

  // Visual AI (tier 4) also needs a screenshot, and LLM (tier 5) needs a
  // pageSource. If the context has neither, the remaining tiers can't do
  // better than we did, so tell the orchestrator to give up — saves an
  // LLM round-trip when context collection actually failed upstream.
  shouldSkipRemaining(context: HealingContext): boolean {
    return !context.screenshotBase64 && !context.pageSource;
  }

  async heal(context: HealingContext): Promise<HealedElement | null> {
    if (!context.screenshotBase64) {
      this.logger.debug('No screenshot available for OCR matching');
      return null;
    }

    try {
      // Extract what text we are looking for from the selector
      const soughtText = this.extractTextHint(context.selector);
      if (!soughtText) return null;

      this.logger.info(`Attempting OCR search for text: "${soughtText}"`);

      // Read the screenshot as Omni-Vision's `-custom:ai-text` does: the text
      // may cover several neighbouring words ("Sign in"), and a word that is
      // only part of it ("Log" for "Login") is no match. The first match in
      // reading order, as `findElement` with that locator returns.
      const [match] = await Container.get(OmniVisionService).findTextInScreenshot(
        context.screenshotBase64,
        soughtText,
      );
      if (!match) return null;

      this.logger.info(
        `✅ OCR found text "${match.text}" at ${JSON.stringify({ x0: match.x0, y0: match.y0, x1: match.x1, y1: match.y1 })}`,
      );
      const found = {
        tier: this.tier,
        confidence: match.confidence / 100,
        originalSelector: context.selector,
        originalStrategy: context.strategy,
        recommendedSelector: `ocr:text="${match.text}"`,
        recommendedStrategy: 'xenon:visual',
        message: `Found text "${match.text}" via local OCR (${match.confidence.toFixed(0)}% confidence)`,
        text: match.text,
        rect: {
          x: match.x0,
          y: match.y0,
          width: match.x1 - match.x0,
          height: match.y1 - match.y0,
        },
      };

      // On an iPhone, the element whose label holds the text, when there is one.
      try {
        const element = await context.driver
          .findElement(
            '-ios predicate string',
            `label CONTAINS[c] "${match.text.replace(/"/g, '\\"')}"`,
          )
          .catch(() => null);
        const elementId = element?.ELEMENT || element?.['element-6066-11e4-a52e-4f735466cecf'];
        if (elementId) {
          this.logger.info('🎯 OCR resolved to real element via predicate search');
          return { id: elementId, ...found };
        }
      } catch (predErr: any) {
        this.logger.debug(`Predicate search failed: ${predErr.message}`);
      }

      // Otherwise where the text is: the interceptor returns it as a virtual
      // element, which a click taps.
      return { id: `healed_ocr_${Date.now()}`, ...found };
    } catch (err: any) {
      this.logger.error(`Error during OCR healing: ${err.message}`);
    }

    return null;
  }

  private extractTextHint(selector: string): string | null {
    // If selector is //*[@text='Login'] or similar, grab 'Login'
    const textMatch =
      selector.match(/text=['"]([^'"]+)['"]/i) ||
      selector.match(/content-desc=['"]([^'"]+)['"]/i) ||
      selector.match(/label=['"]([^'"]+)['"]/i) ||
      selector.match(/name=['"]([^'"]+)['"]/i);

    if (textMatch) return textMatch[1];

    // Otherwise try to grab last part of selector if it looks like words
    const parts = selector.split(/[\/\@\[\]\=\'\"]/);
    const lastWord = parts.reverse().find((p) => p.length > 3);
    return lastWord || null;
  }
}
