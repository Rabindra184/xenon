import { Service, Inject, Container } from 'typedi';
import log from '../logger';
import { IDeviceManager } from '../interfaces/IDeviceManager';
import { PluginContext } from '../PluginContext';
import { XMLParser } from 'fast-xml-parser';
import { OmniVisionService } from './omni-vision/OmniVisionService';
import { SessionManager } from '../sessions/SessionManager';
import { XenonSession } from '../sessions/XenonSession';
import { isManualLock } from './recording/manualLock';

/**
 * Where the hierarchy in a snapshot came from.
 *
 * `appium-session` is the tree the driver itself would resolve a locator
 * against — the only trustworthy answer when a session is running, and the
 * only obtainable one on Android (see XenonSession.getPageSource).
 */
export type HierarchySource = 'appium-session' | 'device';

/**
 * Uniqueness is answered from one pass over the parsed document rather than
 * a walk per locator per node. Keys are `${kind}\u0000${value}`; the NUL keeps
 * a value that happens to contain the kind's name from colliding.
 */
type UniquenessIndex = Map<string, number>;

/**
 * An attribute as a string, or undefined when it is absent.
 *
 * The XML parser runs with `parseAttributeValue`, so a TextView reading "22"
 * — a clock, a badge, a count — arrives as the NUMBER 22. `InspectorNode.text`
 * and `.name` are declared string, and every consumer takes them at their
 * word: the tree view calls `.slice`, the code generator calls `.replace`. A
 * lock-screen clock was enough to throw `text.slice is not a function` and
 * take the whole panel down with it.
 *
 * Coerced here, at the one place these fields are produced, rather than
 * defended against at each of the places they are read.
 */
function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : String(value);
}

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
  /** Which tree this is — see HierarchySource. Surfaced in the UI. */
  hierarchySource: HierarchySource;
  /** The session the hierarchy came from, null when it came from the device. */
  sessionId: string | null;
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

      // 2. Parallel Capture (Hierarchy + Screenshot)
      //
      // The screenshot stays a device-level read on purpose: `adb exec-out
      // screencap` and WDA's screenshot endpoint both work alongside a live
      // session, and the device path is the faster of the two. Only the
      // hierarchy has a conflict to route around.
      const [screenshotBase64, sourced] = await Promise.all([
        manager.getScreenshot
          ? manager.getScreenshot(udid)
          : Promise.reject('Screenshot not supported'),
        this.capturePageSource(udid, device, manager),
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
      const hierarchy = this.parseXmlHierarchy(sourced.xml, device.platform);

      return {
        udid,
        platform: device.platform,
        timestamp: new Date().toISOString(),
        screenshot: screenshotBase64,
        hierarchy,
        hierarchySource: sourced.origin,
        sessionId: sourced.sessionId,
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

  /**
   * The Appium session driving this device, if there is one.
   *
   * `device.session_id` doubles as the dashboard's manual lock — that is the
   * dashboard holding the device for preview or recording, not a driver, and
   * it cannot answer a page-source request.
   */
  private liveSession(device: any): XenonSession | undefined {
    const blockId = device?.session_id;
    if (!blockId || isManualLock(String(blockId))) return undefined;
    return Container.get(SessionManager).getSession(String(blockId));
  }

  /**
   * Session first, device second.
   *
   * This ordering is the whole point of the inspector working at all while a
   * test runs: on Android the device-level `uiautomator dump` is killed by the
   * running uiautomator2 server, so before this the two features were mutually
   * exclusive — you could inspect a device or drive it, never both. It is also
   * the more correct tree regardless of platform, because it is the one Appium
   * will resolve the locators we suggest against.
   *
   * The device path stays as the fallback for every case where there is no
   * session, and for a session that cannot answer.
   */
  private async capturePageSource(
    udid: string,
    device: any,
    manager: IDeviceManager,
  ): Promise<{ xml: string; origin: HierarchySource; sessionId: string | null }> {
    const session = this.liveSession(device);

    if (session) {
      const sessionId = session.getId();
      try {
        const xml = await session.getPageSource();
        if (xml) {
          this.log.info(`Sourced hierarchy for ${udid} from Appium session ${sessionId}`);
          return { xml, origin: 'appium-session', sessionId };
        }
        this.log.warn(
          `Appium session ${sessionId} returned an empty page source for ${udid}; falling back to the device.`,
        );
      } catch (err: any) {
        this.log.warn(
          `Appium session ${sessionId} page source failed for ${udid}: ${err.message}. Falling back to the device.`,
        );
      }
    }

    if (!manager.getPageSource) throw new Error('Page source not supported on this platform');

    const xml = await manager.getPageSource(udid);
    if (!xml) {
      // Empty is a failure, not an empty screen. Returning it produced a
      // one-node "error" tree that looked like a device with no UI, which is
      // exactly how the session conflict hid for so long.
      throw new Error(
        session
          ? `Could not read the UI hierarchy for ${udid}: the Appium session did not answer, and the device-level dump is blocked while a session holds the UiAutomator instrumentation.`
          : `Could not read the UI hierarchy for ${udid}. The screen may be locked, or showing a FLAG_SECURE surface.`,
      );
    }
    return { xml, origin: 'device', sessionId: null };
  }

  private parseXmlHierarchy(xml: string, platform: string): InspectorNode {
    try {
      const jsonObj = this.parser.parse(xml);
      const uniqueness = this.buildUniquenessIndex(jsonObj);

      if (platform === 'android') {
        // The tree is rooted at <hierarchy>, the document element, for two
        // reasons. It is what Appium evaluates XPath against, so an absolute
        // locator has to start there or it matches nothing. And a screen with
        // more than one window — a dialog, or just the IME being up — has
        // several sibling roots under it; anchoring on the first one silently
        // hid every other window.
        const doc = jsonObj.hierarchy ?? jsonObj;
        return this.transformAndroidNode(doc, uniqueness, '/hierarchy[1]', 'hierarchy');
      } else {
        // iOS hierarchy usually starts with <AppiumAUT>
        const root = jsonObj.AppiumAUT || jsonObj;
        const rootKey =
          Object.keys(root || {}).find((k) => k.startsWith('XCUIElement')) || 'AppiumAUT';
        return this.transformIosNode(root, uniqueness, `/${rootKey}[1]`);
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

  /**
   * A node's element children, normalised across the two Android hierarchy
   * shapes.
   *
   *   `uiautomator dump`  ->  <hierarchy><node class="android.widget.Button" …>
   *   Appium page source  ->  <hierarchy><android.widget.Button class="…" …>
   *
   * Only the first was ever handled, so a tree taken from a session (the only
   * kind obtainable while a test is running) collapsed to a single childless
   * node. The shared rule is that a child is an object-valued entry, and its
   * class is the `class` attribute or, failing that, the tag it arrived under.
   */
  private androidChildren(node: any): Array<{ className: string; raw: any }> {
    if (!node || typeof node !== 'object') return [];

    const found: Array<{ className: string; raw: any; index: number | null }> = [];
    for (const [key, value] of Object.entries(node)) {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const cls = typeof (item as any).class === 'string' ? (item as any).class : '';
        const className = cls || (key === 'node' ? 'Unknown' : key);
        const rawIndex = (item as any).index;
        found.push({
          className,
          raw: item,
          index: typeof rawIndex === 'number' ? rawIndex : null,
        });
      }
    }

    // fast-xml-parser groups same-named tags together, so under the Appium
    // shape children arrive grouped by class rather than in document order.
    // Both shapes carry `index` — the child's position under its parent — so
    // sorting by it restores the order the screen actually has. The tree view
    // and every positional XPath below depend on that order.
    if (found.length > 1 && found.every((c) => c.index !== null)) {
      found.sort((a, b) => (a.index as number) - (b.index as number));
    }

    return found.map(({ className, raw }) => ({ className, raw }));
  }

  private transformAndroidNode(
    node: any,
    uniqueness: UniquenessIndex,
    xpath: string,
    className: string,
  ): InspectorNode {
    const type = className || node.class || 'Unknown';
    const text = asText(node.text);
    const name = asText(node.resourceId) || text || type.split('.').pop() || 'node';
    const bounds = this.parseAndroidBounds(node.bounds || '[0,0][0,0]');

    // Build children with positional xpath segments so siblings of the same
    // class are addressable independently. Without this every child of the
    // same type collapses to one identity in the dashboard tree.
    const typeIndices: Record<string, number> = {};
    const children: InspectorNode[] = this.androidChildren(node).map((c) => {
      typeIndices[c.className] = (typeIndices[c.className] || 0) + 1;
      const childXpath = `${xpath}/${c.className}[${typeIndices[c.className]}]`;
      return this.transformAndroidNode(c.raw, uniqueness, childXpath, c.className);
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
      text,
      rect: bounds,
      xpath,
      suggestedLocators: [],
      suggestedActions: [],
      children,
      attributes,
    };

    nodeObj.suggestedLocators = this.generateLocators(nodeObj, 'android', uniqueness);
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

  private transformIosNode(node: any, uniqueness: UniquenessIndex, xpath: string): InspectorNode {
    const type = Object.keys(node).find((k) => k.startsWith('XCUIElement')) || 'Unknown';
    const data = node[type];

    const name = asText(data?.name) || asText(data?.label) || type;
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
      return this.transformIosNode({ [cd.type]: cd.data }, uniqueness, childXpath);
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
      text: asText(data?.label) || asText(data?.value),
      rect,
      xpath,
      suggestedLocators: [],
      suggestedActions: [],
      children,
      attributes,
    };

    nodeObj.suggestedLocators = this.generateLocators(nodeObj, 'ios', uniqueness);
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

  private generateLocators(
    node: InspectorNode,
    platform: string,
    uniqueness: UniquenessIndex,
  ): LocatorSuggestion[] {
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
        unique: this.isUnique(uniqueness, 'accessibility id', val),
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
        unique: this.isUnique(uniqueness, 'id', resId),
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
          unique: this.isUnique(uniqueness, 'id', resId),
          score: 88,
        });
      }
      if (node.text) {
        suggestions.push({
          strategy: '-android uiautomator',
          value: `new UiSelector().text("${node.text}")`,
          unique: this.isUnique(uniqueness, 'text', node.text),
          score: 80,
        });
      }
    }

    // 4. XPath
    //
    // The tag is the element's FULL class name, not its last segment. Appium
    // evaluates XPath against its own page source, where an Android element's
    // tag is the fully-qualified class — `//Button[…]` matches nothing there,
    // it has to be `//android.widget.Button[…]`. That holds even when this
    // tree came from a `uiautomator dump` instead, because the locator is for
    // Appium to run, not for the document we happen to have parsed. iOS types
    // carry no dots, so this reads the same for them.
    const tagName = node.type;

    if (resId) {
      suggestions.push({
        strategy: 'xpath',
        value: `//${tagName}[@resource-id="${resId}"]`,
        unique: this.isUnique(uniqueness, 'id', resId),
        score: 70,
      });
    } else if (node.text) {
      suggestions.push({
        strategy: 'xpath',
        value: `//${tagName}[@text="${node.text}"]`,
        unique: this.isUnique(uniqueness, 'text', node.text),
        score: 60,
      });
    } else if (contentDesc) {
      suggestions.push({
        strategy: 'xpath',
        value: `//${tagName}[@content-desc="${contentDesc}"]`,
        unique: this.isUnique(uniqueness, 'accessibility id', contentDesc),
        score: 65,
      });
    }

    return suggestions;
  }

  /**
   * Count every locatable value in the document once, so uniqueness is a map
   * lookup per suggestion rather than a fresh walk of the tree per suggestion
   * per node.
   *
   * The walk descends into every object-valued entry, which is what makes it
   * agree with all three hierarchy shapes at once: `<node>` children from a
   * dump, class-named tags from Appium on Android, and the
   * `{ XCUIElementTypeX: {...} }` nesting on iOS. The previous walk understood
   * only the first, and even there it read a parent's attributes off its first
   * child — so counts were wrong in both directions and `unique` was closer to
   * a guess than a fact.
   *
   * Each `bump` mirrors exactly how generateLocators picks that strategy's
   * value; if the two ever disagree the count is for a value no suggestion
   * carries.
   */
  private buildUniquenessIndex(parsed: any): UniquenessIndex {
    const counts: UniquenessIndex = new Map();

    const bump = (kind: string, value: any) => {
      if (value === undefined || value === null || value === '') return;
      const key = `${kind}\u0000${String(value)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    };

    const visit = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(visit);
        return;
      }
      bump('id', obj.resourceId || obj['resource-id'] || obj.identifier);
      bump(
        'accessibility id',
        obj.contentDescription || obj['content-desc'] || obj.name || obj.label,
      );
      bump('text', obj.text || obj.label || obj.value);
      Object.values(obj).forEach((v) => {
        if (v && typeof v === 'object') visit(v);
      });
    };

    visit(parsed);
    return counts;
  }

  private isUnique(uniqueness: UniquenessIndex, kind: string, value: string): boolean {
    return uniqueness.get(`${kind}\u0000${String(value)}`) === 1;
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
