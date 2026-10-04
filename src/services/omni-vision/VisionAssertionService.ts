import { Service } from 'typedi';
import { errors } from '@appium/base-driver';
import { AI_SERVICE, VisualVerdict } from '../AIService';
import log from '../../logger';

@Service()
export class VisionAssertionService {
  private logger = log.scope('VisionAssertion');

  /**
   * `xenon: assertVisualState`: whether `instruction`, a condition in plain
   * words, holds on the device's screen now, as the AI provider judges it from
   * a screenshot.
   *
   * Answers `{ result, message }` only with the provider's own verdict.
   * Whenever there is none it fails, saying the condition was not checked: no
   * condition, no screenshot, no AI provider, a failed or rate-limited call,
   * or an answer that isn't true or false. It never answers `false` for "could
   * not check": a test asserting that something is absent would pass. Through
   * 2.13.2 it answered `{ result: true, message: 'Assertion placeholder' }` in
   * all of those cases.
   */
  async assertState(driver: any, instruction: string): Promise<VisualVerdict> {
    const condition = typeof instruction === 'string' ? instruction.trim() : '';
    if (!condition) {
      throw new errors.InvalidArgumentError(
        'assertVisualState needs a condition to check, as a string or { instruction }, ' +
          "for example 'The cart is empty'.",
      );
    }
    this.logger.info(`Asserting visual state: "${condition}"`);

    let screenshot: string;
    try {
      screenshot = await driver.getScreenshot();
    } catch (err: any) {
      throw new Error(
        `No screenshot could be taken, so the condition was not checked: ${err?.message ?? err}`,
      );
    }
    if (!screenshot) {
      throw new Error('No screenshot could be taken, so the condition was not checked.');
    }

    const verdict = await AI_SERVICE.assertVisual(screenshot, condition);
    this.logger.info(`"${condition}": ${verdict.result} (${verdict.message})`);
    return verdict;
  }
}
