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

  /**
   * Omni-Click: OCR-driven click by visible text.
   * Designed as a modern, enterprise command with predictable arguments + structured response.
   */
  async omniClick(
    driver: any,
    payload?: { text?: string; index?: number; takeANewScreenShot?: boolean },
  ) {
    const text = payload?.text;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('omniClick requires a non-empty "text" string');
    }
    const index = typeof payload?.index === 'number' ? payload!.index : 1;
    const takeANewScreenShot =
      typeof payload?.takeANewScreenShot === 'boolean' ? payload!.takeANewScreenShot : true;

    this.logger.info(
      `Omni-Click requested. text="${text}" index=${index} takeANewScreenShot=${takeANewScreenShot}`,
    );
    return await Container.get(OmniVisionService).omniClickByText(driver, {
      text,
      index,
      takeANewScreenShot,
    });
  }

  /**
   * Visual-Tap: AI-driven click by visual description (icons, buttons, etc).
   */
  async visualTap(driver: any, payload?: { icon?: string; description?: string; takeANewScreenShot?: boolean }) {
    const icon = payload?.icon || payload?.description;
    if (!icon || typeof icon !== 'string' || icon.trim().length === 0) {
      throw new Error('visualTap requires a non-empty "icon" or "description" string');
    }
    const takeANewScreenShot =
      typeof payload?.takeANewScreenShot === 'boolean' ? payload!.takeANewScreenShot : true;

    this.logger.info(
      `Visual-Tap requested. target="${icon}" takeANewScreenShot=${takeANewScreenShot}`,
    );
    return await Container.get(OmniVisionService).omniClickByIcon(driver, {
      icon,
      takeANewScreenShot,
    });
  }

  /**
   * UI Scan Export: OCR + lightweight visual metadata export.
   */
  async uiScanExport(driver: any, payload?: { takeANewScreenShot?: boolean; maxItems?: number }) {
    const takeANewScreenShot =
      typeof payload?.takeANewScreenShot === 'boolean' ? payload!.takeANewScreenShot : true;
    const maxItems = typeof payload?.maxItems === 'number' ? payload!.maxItems : 200;

    this.logger.info(
      `UI Lens export requested. takeANewScreenShot=${takeANewScreenShot} maxItems=${maxItems}`,
    );
    return await Container.get(OmniVisionService).exportUiLensMetadata(driver, {
      takeANewScreenShot,
      maxItems,
    });
  }

  /**
   * Smart Tap: Xenon-native, self-explanatory alias of omniClick/visualTap.
   * Automatically switches between text-based and icon-based matching.
   */
  async smartTap(
    driver: any,
    payload?: { text?: string; icon?: string; description?: string; index?: number; takeANewScreenShot?: boolean },
  ) {
    this.logger.info(`smartTap payload: ${JSON.stringify(payload)}`);
    const icon = payload?.icon || payload?.description;
    const text = payload?.text;

    // Prioritize visual description if provided
    if (icon && typeof icon === 'string' && icon.trim().length > 0) {
      this.logger.info(`Routing smartTap to visualTap (icon detected: "${icon}")`);
      return await this.visualTap(driver, payload as any);
    }

    this.logger.info(`Routing smartTap to omniClick (text detected: "${text}")`);
    return await this.omniClick(driver, payload as any);
  }

  /**
   * UI Inventory: Xenon-native, self-explanatory alias of uiScanExport.
   */
  async uiInventory(driver: any, payload?: { takeANewScreenShot?: boolean; maxItems?: number }) {
    return await this.uiScanExport(driver, payload);
  }
}
