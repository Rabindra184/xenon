import { Service, Inject, Container } from 'typedi';
import log from '../logger';
import { IDeviceManager } from '../interfaces/IDeviceManager';
import { PluginContext } from '../PluginContext';
import { XMLParser } from 'fast-xml-parser';
import { OmniVisionService } from './omni-vision/OmniVisionService';

export interface LocatorSuggestion {
  strategy: string;
  value: string;
  unique: boolean;
  score: number; // 0-100 (robustness)
}

export interface SuggestedAction {
  action: string;
  snippet: string;
  description: string;
}

export interface InspectorNode {
  name: string;
  type: string;
  text?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  visible?: boolean;
  rect: { x: number; y: number; width: number; height: number };
  xpath: string;
  suggestedLocators: LocatorSuggestion[];
  suggestedActions: SuggestedAction[];
  children: InspectorNode[];
  attributes: Record<string, any>;
}

export interface InspectorSnapshot {
  udid: string;
  platform: string;
  timestamp: string;
  screenshot: string;
  hierarchy: InspectorNode;
  metadata: {
    screenWidth: number;
    screenHeight: number;
  };
}

@Service()
export class InspectorService {
  private log = log.scope('Inspector');
  private parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
  });

  constructor(@Inject() private context: PluginContext) {}

  async getSnapshot(udid: string): Promise<InspectorSnapshot> {
    try {
      this.log.info(`Generating deep snapshot for device: ${udid}`);

      // 1. Get Device Manager
      const device = await Container.get<any>('DeviceStore').findDevice({ udid });
      if (!device) throw new Error(`Device ${udid} not found`);

      let manager: IDeviceManager;
      if (device.platform === 'android') {
        manager = Container.get<any>('AndroidDeviceManager');
      } else {
        manager = Container.get<any>('IOSDeviceManager');
      }

      // 2. Parallel Capture (Native Source + Screenshot)
      const [screenshotBase64, xmlSource] = await Promise.all([
        manager.getScreenshot
          ? manager.getScreenshot(udid)
          : Promise.reject('Screenshot not supported'),
        manager.getPageSource
          ? manager.getPageSource(udid)
          : Promise.reject('Page source not supported'),
      ]);

      // 3. Ensure Metadata (Lazy load dimensions if missing)
      if (!device.screenWidth || !device.screenHeight) {
        try {
          if (manager.getAdditionalDeviceInfo) {
            const additional = await manager.getAdditionalDeviceInfo(device);
            Object.assign(device, additional);
            // Update store asynchronously
            Container.get<any>('DeviceStore')
              .updateDevice(udid, device.host, additional)
              .catch(() => {});
          }
        } catch (e) {
          this.log.warn(`Failed to lazy-load dimensions for ${udid}: ${e}`);
        }
      }

      // 4. Parse Native Hierarchy
      const hierarchy = this.parseXmlHierarchy(xmlSource, device.platform);

      return {
        udid,
        platform: device.platform,
        timestamp: new Date().toISOString(),
        screenshot: screenshotBase64,
        hierarchy,
        metadata: {
          screenWidth: parseInt(device.screenWidth || '0') || 393, // Fallback to common iPhone width
          screenHeight: parseInt(device.screenHeight || '0') || 852,
        },
      };
    } catch (err: any) {
      this.log.error(`Failed to generate deep snapshot for ${udid}: ${err.message}`);
      throw err;
    }
  }

  private parseXmlHierarchy(xml: string, platform: string): InspectorNode {
    try {
      const jsonObj = this.parser.parse(xml);

      if (platform === 'android') {
        // Android hierarchy usually starts with <hierarchy>
        const root = jsonObj.hierarchy?.node || jsonObj.hierarchy;
        return this.transformAndroidNode(root, '');
      } else {
        // iOS hierarchy usually starts with <AppiumAUT>
        const root = jsonObj.AppiumAUT || jsonObj;
        return this.transformIosNode(root, '');
      }
    } catch (e: any) {
      this.log.error(`Failed to parse XML hierarchy: ${e.message}`);
      return {
        name: 'root',
        type: 'error',
        rect: { x: 0, y: 0, width: 0, height: 0 },
        xpath: '/',
        children: [],
        attributes: {},
        suggestedLocators: [],
        suggestedActions: [],
      };
    }
  }

  private transformAndroidNode(node: any, root: any): InspectorNode {
    const type = node.class || 'Unknown';
    const name = node.resourceId || node.text || type.split('.').pop() || 'node';
    const bounds = this.parseAndroidBounds(node.bounds || '[0,0][0,0]');

    const xpath = node.xpath || ''; // Placeholder for now, real xpath handled by generator

    const children = Array.isArray(node.node)
      ? node.node.map((c: any) => this.transformAndroidNode(c, root))
      : node.node
        ? [this.transformAndroidNode(node.node, root)]
        : [];

    const attributes: Record<string, any> = {};
    Object.entries(node).forEach(([key, value]) => {
      // Filter out internal structural keys and non-primitive values
      if (
        key !== 'node' &&
        key !== 'xpath' &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      ) {
        attributes[key] = value;
      }
    });

    const nodeObj: InspectorNode = {
      name,
      type,
      text: node.text,
      rect: bounds,
      xpath,
      suggestedLocators: [],
      suggestedActions: [],
      children,
      attributes,
    };

    nodeObj.suggestedLocators = this.generateLocators(nodeObj, 'android', root);
    nodeObj.suggestedActions = this.generateActions(nodeObj);
    nodeObj.xpath = nodeObj.suggestedLocators.find((l) => l.strategy === 'xpath')?.value || '/';

    return nodeObj;
  }

  private transformIosNode(node: any, root: any): InspectorNode {
    const type = Object.keys(node).find((k) => k.startsWith('XCUIElement')) || 'Unknown';
    const data = node[type];

    const name = data?.name || data?.label || type;
    const rect = {
      x: data?.x || 0,
      y: data?.y || 0,
      width: data?.width || 0,
      height: data?.height || 0,
    };

    const children: InspectorNode[] = [];
    Object.keys(data || {}).forEach((key) => {
      if (key.startsWith('XCUIElement')) {
        const childData = data[key];
        if (Array.isArray(childData)) {
          childData.forEach((c) => children.push(this.transformIosNode({ [key]: c }, root)));
        } else {
          children.push(this.transformIosNode({ [key]: childData }, root));
        }
      }
    });

    const attributes: Record<string, any> = {};
    Object.entries(data || {}).forEach(([key, value]) => {
      // Filter out nested element keys (XCUIElement...) and non-primitive values
      if (
        !key.startsWith('XCUIElement') &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      ) {
        attributes[key] = value;
      }
    });

    const nodeObj: InspectorNode = {
      name,
      type,
      text: data?.label || data?.value,
      rect,
      xpath: '',
      suggestedLocators: [],
      suggestedActions: [],
      children,
      attributes,
    };

    nodeObj.suggestedLocators = this.generateLocators(nodeObj, 'ios', root);
    nodeObj.suggestedActions = this.generateActions(nodeObj);
    nodeObj.xpath = nodeObj.suggestedLocators.find((l) => l.strategy === 'xpath')?.value || '/';

    return nodeObj;
  }

  private generateActions(node: InspectorNode): SuggestedAction[] {
    const actions: SuggestedAction[] = [];
    const type = node.type.toLowerCase();

    // Common clickable elements
    if (
      type.includes('button') ||
      type.includes('imageview') ||
      type.includes('icon') ||
      node.attributes.clickable === 'true' ||
      node.attributes.enabled === 'true'
    ) {
      actions.push({
        action: 'click',
        snippet: `await element.click();`,
        description: 'Performs a single tap interaction',
      });
    }

    // Common input elements
    if (
      type.includes('edit') ||
      type.includes('textfield') ||
      type.includes('input') ||
      type.includes('search')
    ) {
      actions.push({
        action: 'sendKeys',
        snippet: `await element.sendKeys("value");`,
        description: 'Inputs text into the element',
      });
      actions.push({
        action: 'clear',
        snippet: `await element.clear();`,
        description: 'Clears the text content',
      });
    }

    return actions;
  }

  private generateLocators(node: InspectorNode, platform: string, root: any): LocatorSuggestion[] {
    const primarySuggestions: LocatorSuggestion[] = [];

    // 1. Accessibility ID / Resource ID (Highest Priority)
    const accId =
      node.attributes.accessibilityId || node.attributes.name || node.attributes.resourceId;
    if (accId) {
      const strategy = platform === 'android' ? 'id' : 'accessibility id';
      primarySuggestions.push({
        strategy,
        value: accId,
        unique: this.checkUniqueness(root, strategy, accId),
        score: 100,
      });
    }

    // 2. Platform Specific (Class Chain / UiAutomator)
    if (platform === 'ios') {
      const predicate = `type == "${node.type}" AND label == "${node.text || ''}"`;
      primarySuggestions.push({
        strategy: '-ios predicate string',
        value: predicate,
        unique: true, // Predicates can be complex, assuming uniqueness for now
        score: 90,
      });
    } else {
      const uiSelector = `new UiSelector().className("${node.type}").text("${node.text || ''}")`;
      primarySuggestions.push({
        strategy: '-android uiautomator',
        value: uiSelector,
        unique: true,
        score: 85,
      });
    }

    // 3. XPath (Fallback)
    const xpath = `//${node.type.split('.').pop()}[@text="${node.text || ''}"]`;
    primarySuggestions.push({
      strategy: 'xpath',
      value: xpath,
      unique: this.checkUniqueness(root, 'xpath', xpath),
      score: 50,
    });

    return primarySuggestions;
  }

  private checkUniqueness(root: any, strategy: string, value: string): boolean {
    // Implementation of a lightweight uniqueness checker across the parsed XML/JSON tree
    let matches = 0;
    const search = (n: any) => {
      if (strategy === 'id' || strategy === 'accessibility id') {
        if (n.resourceId === value || n.accessibilityId === value || n.name === value) matches++;
      }
      if (matches > 1) return;
      const children = n.node || [];
      if (Array.isArray(children)) children.forEach(search);
      else if (children) search(children);
    };
    search(root);
    return matches === 1;
  }

  private parseAndroidBounds(boundsStr: string) {
    const matches = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(boundsStr);
    if (matches) {
      const x1 = parseInt(matches[1]);
      const y1 = parseInt(matches[2]);
      const x2 = parseInt(matches[3]);
      const y2 = parseInt(matches[4]);
      return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}
