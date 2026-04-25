import { HealingProvider, HealingTier, HealedElement, HealingContext } from './types';
import Tesseract from 'tesseract.js';
import log from '../../logger';

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

      // Run OCR on the screenshot
      const buffer = Buffer.from(context.screenshotBase64, 'base64');
      const result: any = await Tesseract.recognize(buffer, 'eng');
      const { words } = result.data;

      // Look for the best word match
      const bestWord = words
        ? words.find(
            (w: any) =>
              w.text.toLowerCase().includes(soughtText.toLowerCase()) ||
              soughtText.toLowerCase().includes(w.text.toLowerCase()),
          )
        : null;

      if (bestWord) {
        this.logger.info(
          `✅ OCR found text "${bestWord.text}" at ${JSON.stringify(bestWord.bbox)}`,
        );

        // Convert bbox to center coordinates
        const x = Math.round((bestWord.bbox.x0 + bestWord.bbox.x1) / 2);
        const y = Math.round((bestWord.bbox.y0 + bestWord.bbox.y1) / 2);

        // Try to get the REAL element at these coordinates by tapping
        try {
          // Use W3C Actions to tap at the OCR-detected coordinates, then find the element at that position
          const element = await context.driver
            .findElement(
              '-ios predicate string',
              `label CONTAINS[c] "${bestWord.text.replace(/"/g, '\\"')}"`,
            )
            .catch(() => null);

          if (element) {
            const elementId = element.ELEMENT || element['element-6066-11e4-a52e-4f735466cecf'];
            if (elementId) {
              this.logger.info('🎯 OCR resolved to real element via predicate search');
              return {
                id: elementId,
                tier: this.tier,
                confidence: bestWord.confidence / 100,
                originalSelector: context.selector,
                originalStrategy: context.strategy,
                recommendedSelector: `ocr:text="${bestWord.text}"`,
                recommendedStrategy: 'xenon:visual',
                message: `Found text "${bestWord.text}" via local OCR (${bestWord.confidence.toFixed(0)}% confidence)`,
                rect: {
                  x: bestWord.bbox.x0,
                  y: bestWord.bbox.y0,
                  width: bestWord.bbox.x1 - bestWord.bbox.x0,
                  height: bestWord.bbox.y1 - bestWord.bbox.y0,
                },
              };
            }
          }
        } catch (predErr: any) {
          this.logger.debug(`Predicate search failed: ${predErr.message}`);
        }

        // Fallback: Return coordinate-based result with virtual ID
        // The CommandInterceptor handles rect-based results via coordinate tap
        return {
          id: `healed_ocr_${Date.now()}`,
          tier: this.tier,
          confidence: bestWord.confidence / 100,
          originalSelector: context.selector,
          originalStrategy: context.strategy,
          recommendedSelector: `ocr:text="${bestWord.text}"`,
          recommendedStrategy: 'xenon:visual',
          message: `Found text "${bestWord.text}" via local OCR (${bestWord.confidence.toFixed(0)}% confidence)`,
          rect: {
            x: bestWord.bbox.x0,
            y: bestWord.bbox.y0,
            width: bestWord.bbox.x1 - bestWord.bbox.x0,
            height: bestWord.bbox.y1 - bestWord.bbox.y0,
          },
        };
      }
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
