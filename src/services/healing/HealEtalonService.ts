import { Service } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/device-store';
import log from '../../logger';

export interface LocatorSignature {
  selector: string;
  strategy: string;
  attributes: Record<string, string>;
  nodeName: string;
  path?: any; // JSON representation of resiliotree.Path
  lastSeen: number;
}

@Service()
export class HealEtalonService {
  private logger = log.scope('HealEtalonService');
  private store = DeviceStoreFactory.getHealEtalonStore();

  constructor() { }

  /**
   * Saves or updates a signature for a successful locator
   */
  async saveSignature(strategy: string, selector: string, node: any, path?: any): Promise<void> {
    try {
      const attributes: Record<string, string> = {};

      // Extract identifying attributes
      const nodeAttrs = node.attributes || [];
      const anchorNames = ['content-desc', 'resource-id', 'text', 'name', 'id', 'hint'];

      for (let i = 0; i < nodeAttrs.length; i++) {
        const attr = nodeAttrs[i];
        if (anchorNames.includes(attr.name.toLowerCase())) {
          attributes[attr.name.toLowerCase()] = attr.value;
        }
      }

      const signature: LocatorSignature = {
        selector,
        strategy,
        attributes,
        nodeName: node.nodeName || 'Unknown',
        path,
        lastSeen: Date.now(),
      };

      await this.store.saveSignature(signature);
      this.logger.debug(`Saved signature for locator: ${selector}`);
    } catch (err: any) {
      this.logger.error(`Failed to save signature: ${err.message}`);
    }
  }

  /**
   * Retrieves a signature for a locator
   */
  async getSignature(selector: string): Promise<LocatorSignature | null> {
    try {
      return await this.store.getSignature(selector);
    } catch (err: any) {
      this.logger.error(`Failed to retrieve signature: ${err.message}`);
      return null;
    }
  }
}
