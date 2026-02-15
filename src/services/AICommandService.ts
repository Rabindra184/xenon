import { Container, Service } from 'typedi';
import log from '../logger';
import { OmniVisionService } from './omni-vision/OmniVisionService';
import { VisionAssertionService } from './omni-vision/VisionAssertionService';

@Service()
export class AICommandService {
  private logger = log.scope('AICommandService');

  async analyzeScreen(driver: any) {
    this.logger.info('Analyzing screen via AI...');
    return await Container.get(OmniVisionService).analyzeScreen(driver);
  }

  async assertVisualState(driver: any, instruction: string) {
    this.logger.info(`Asserting visual state: ${instruction}`);
    return await Container.get(VisionAssertionService).assertState(driver, instruction);
  }

  async omniScan(driver: any) {
    this.logger.info('Performing Omni-Scan...');
    return await Container.get(OmniVisionService).analyzeScreen(driver);
  }

  async testAiLocator(driver: any, locator: { strategy: string; selector: string }) {
    this.logger.info(`Testing AI locator: ${locator.strategy}=${locator.selector}`);
    const omniService = Container.get(OmniVisionService);

    if (locator.strategy === '-custom:ai-text') {
      return await omniService.findByText(driver, locator.selector);
    } else if (locator.strategy === '-custom:ai-icon') {
      const result = await omniService.findByIcon(driver, locator.selector);
      return result ? [result] : [];
    }

    throw new Error(`Unsupported AI strategy: ${locator.strategy}`);
  }
}
