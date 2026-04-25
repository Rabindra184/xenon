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
        const rootType: string = (root?.class as string) || 'hierarchy';
        return this.transformAndroidNode(root, root, `/${rootType}[1]`);
      } else {
        // iOS hierarchy usually starts with <AppiumAUT>
        const root = jsonObj.AppiumAUT || jsonObj;
        const rootKey =
          Object.keys(root || {}).find((k) => k.startsWith('XCUIElement')) || 'AppiumAUT';
        return this.transformIosNode(root, root, `/${rootKey}[1]`);
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

  private transformAndroidNode(node: any, root: any, xpath: string): InspectorNode {
    const type = node.class || 'Unknown';
    const name = node.resourceId || node.text || type.split('.').pop() || 'node';
    const bounds = this.parseAndroidBounds(node.bounds || '[0,0][0,0]');

    // Build children with positional xpath segments so siblings of the same
    // class are addressable independently. Without this every child of the
    // same type collapses to one identity in the dashboard tree.
    const childNodes: any[] = Array.isArray(node.node)
      ? node.node
      : node.node
        ? [node.node]
        : [];
    const typeIndices: Record<string, number> = {};
    const children: InspectorNode[] = childNodes.map((c) => {
      const cType: string = (c?.class as string) || 'Unknown';
      typeIndices[cType] = (typeIndices[cType] || 0) + 1;
      const childXpath = `${xpath}/${cType}[${typeIndices[cType]}]`;
      return this.transformAndroidNode(c, root, childXpath);
    });

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

    nodeObj.suggestedLocators = this.generateLocators(nodeObj, 'android', root || node);
    if (!nodeObj.suggestedLocators.some((l) => l.strategy === 'xpath')) {
      nodeObj.suggestedLocators.push({
        strategy: 'xpath',
        value: xpath,
        unique: true,
        score: 40,
      });
    }
    nodeObj.suggestedActions = this.generateActions(nodeObj);

    return nodeObj;
  }

  private transformIosNode(node: any, root: any, xpath: string): InspectorNode {
    const type = Object.keys(node).find((k) => k.startsWith('XCUIElement')) || 'Unknown';
    const data = node[type];

    const name = data?.name || data?.label || type;
    const rect = {
      x: data?.x || 0,
      y: data?.y || 0,
      width: data?.width || 0,
      height: data?.height || 0,
    };

    // Flatten children into a single ordered list so the positional index
    // matches XCUITest's own [n] semantics for class-chain / xpath lookups.
    const childData: Array<{ type: string; data: any }> = [];
    Object.keys(data || {}).forEach((key) => {
      if (key.startsWith('XCUIElement')) {
        const c = data[key];
        if (Array.isArray(c)) {
          c.forEach((item) => childData.push({ type: key, data: item }));
        } else {
          childData.push({ type: key, data: c });
        }
      }
    });

    const typeIndices: Record<string, number> = {};
    const children: InspectorNode[] = childData.map((cd) => {
      typeIndices[cd.type] = (typeIndices[cd.type] || 0) + 1;
      const childXpath = `${xpath}/${cd.type}[${typeIndices[cd.type]}]`;
      return this.transformIosNode({ [cd.type]: cd.data }, root, childXpath);
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
      xpath,
      suggestedLocators: [],
      suggestedActions: [],
      children,
      attributes,
    };

    nodeObj.suggestedLocators = this.generateLocators(nodeObj, 'ios', root || node);
    if (!nodeObj.suggestedLocators.some((l) => l.strategy === 'xpath')) {
      nodeObj.suggestedLocators.push({
        strategy: 'xpath',
        value: xpath,
        unique: true,
        score: 40,
      });
    }
    nodeObj.suggestedActions = this.generateActions(nodeObj);

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
        snippet: 'await element.click();',
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
        snippet: 'await element.sendKeys("value");',
        description: 'Inputs text into the element',
      });
      actions.push({
        action: 'clear',
        snippet: 'await element.clear();',
        description: 'Clears the text content',
      });
    }

    return actions;
  }

  private generateLocators(node: InspectorNode, platform: string, root: any): LocatorSuggestion[] {
    const suggestions: LocatorSuggestion[] = [];

    // 1. Accessibility ID - GOLD STANDARD
    // Android: content-desc | iOS: name/accessibility-id
    const contentDesc = node.attributes.contentDescription || node.attributes['content-desc'];
    const iosName = node.attributes.name || node.attributes.label;

    if (contentDesc || iosName) {
      const val = contentDesc || iosName;
      suggestions.push({
        strategy: 'accessibility id',
        value: val,
        unique: this.checkUniqueness(root, 'accessibility id', val),
        score: 100,
      });
    }

    // 2. Resource ID / ID
    // Android: resource-id | iOS: identifier/name
    const resId =
      node.attributes.resourceId || node.attributes['resource-id'] || node.attributes.identifier;
    if (resId) {
      suggestions.push({
        strategy: 'id',
        value: resId,
        unique: this.checkUniqueness(root, 'id', resId),
        score: 95,
      });
    }

    // 3. Platform Specific - Performance Tier
    if (platform === 'ios') {
      // iOS Predicate String - High Performance
      const predicate = `type == "${node.type}" AND label == "${node.text || node.label || ''}"`;
      if (node.text || node.label) {
        suggestions.push({
          strategy: '-ios predicate string',
          value: predicate,
          unique: true,
          score: 90,
        });
      }

      // iOS Class Chain - High Precision
      const classChain =
        `**/${node.type}[` +
        (node.attributes.name
          ? `name == "${node.attributes.name}"`
          : `label == "${node.text || ''}"`) +
        ']';
      suggestions.push({
        strategy: '-ios class chain',
        value: classChain,
        unique: true,
        score: 85,
      });
    } else {
      // Android UIAutomator - Reliable Native
      if (resId) {
        suggestions.push({
          strategy: '-android uiautomator',
          value: `new UiSelector().resourceId("${resId}")`,
          unique: true,
          score: 88,
        });
      }
      if (node.text) {
        suggestions.push({
          strategy: '-android uiautomator',
          value: `new UiSelector().text("${node.text}")`,
          unique: this.checkUniqueness(root, 'text', node.text),
          score: 80,
        });
      }
    }

    // 4. XPath - Stable Semantic version
    // Use tag name from the last part of Class name
    const tagName = node.type.includes('.') ? node.type.split('.').pop() : node.type;

    if (resId) {
      suggestions.push({
        strategy: 'xpath',
        value: `//${tagName}[@resource-id="${resId}"]`,
        unique: true,
        score: 70,
      });
    } else if (node.text) {
      suggestions.push({
        strategy: 'xpath',
        value: `//${tagName}[@text="${node.text}"]`,
        unique: this.checkUniqueness(root, 'xpath', `//${tagName}[@text="${node.text}"]`),
        score: 60,
      });
    } else if (contentDesc) {
      suggestions.push({
        strategy: 'xpath',
        value: `//${tagName}[@content-desc="${contentDesc}"]`,
        unique: true,
        score: 65,
      });
    }

    return suggestions;
  }

  private checkUniqueness(root: any, strategy: string, value: string): boolean {
    let matches = 0;
    const search = (n: any) => {
      const node = n.node || n;
      if (strategy === 'id') {
        if (node.resourceId === value || node['resource-id'] === value || node.identifier === value)
          matches++;
      } else if (strategy === 'accessibility id') {
        if (
          node.accessibilityId === value ||
          node['content-desc'] === value ||
          node.contentDescription === value ||
          node.name === value
        )
          matches++;
      } else if (strategy === 'text') {
        if (node.text === value || node.label === value) matches++;
      }

      if (matches > 1) return;

      const children = n.node || [];
      if (Array.isArray(children)) children.forEach(search);
      else if (n.children && Array.isArray(n.children)) n.children.forEach(search);
      else if (children && typeof children === 'object') search(children);
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
