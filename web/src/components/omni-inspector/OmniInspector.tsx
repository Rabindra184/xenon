import {
  Cpu,
  Layers,
  Copy,
  RotateCw,
  Check,
  ChevronRight,
  Target,
  ChevronDown,
  Box,
  Search,
  Layout,
  Grid3x3,
  MapPin,
  MousePointer2,
  Touchpad,
  Zap,
  Code2,
  Lightbulb,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Sparkles,
  Crosshair,
  HelpCircle,
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import XenonApiService from '../../api-service';
import { matchSelector, type MatchResult } from './selector-matcher';
import './omni-inspector.css';
import React from 'react';

export interface LocatorSuggestion {
  strategy: string;
  value: string;
  unique: boolean;
  score: number;
}

export interface InspectorNode {
  name: string;
  type: string;
  text?: string;
  label?: string;
  value?: string;
  rect: { x: number; y: number; width: number; height: number };
  xpath: string;
  suggestedLocators: LocatorSuggestion[];
  suggestedActions: any[];
  children: InspectorNode[];
  attributes: Record<string, any>;
}

export interface InspectorSnapshot {
  udid: string;
  platform: string;
  timestamp: string;
  screenshot: string;
  hierarchy: InspectorNode;
  metadata: { screenWidth: number; screenHeight: number };
}

interface OmniInspectorProps {
  sessionId?: string | null;
  udid?: string | null;
  streamUrl?: string | null;
  /** When true, hide the inspector's own screenshot panel — host renders the device. */
  embedded?: boolean;
}

// =====================================================================
// AI ENGINE 1: Smart Locator Stability Scorer (Appium 2.x Best Practices)
// Based on official Appium docs: https://appium.io/docs/en/latest/guides/locator-strategies/
// XPath is ~10x slower on iOS. accessibility id is ALWAYS preferred.
// =====================================================================
type StabilityLevel = 'stable' | 'moderate' | 'fragile' | 'very-fragile';

/**
 * Returns a priority rank for Appium locator strategies (lower = better).
 * Aligned with official Appium 2.x recommended priority.
 */
function getLocatorPriority(strategy: string): number {
  const priorityMap: Record<string, number> = {
    'accessibility id': 1, // #1 - portable, fast, works on both platforms
    id: 2, // #2 - resource-id (Android) or bundleId-prefixed (iOS)
    '-ios predicate string': 3, // #3 - iOS-only, native, very fast
    '-ios class chain': 4, // #4 - iOS-only, native
    '-android uiautomator': 3, // #3 - Android-only, native UIAutomator2
    'class name': 8, // Rarely unique
    xpath: 9, // Last resort — slow, fragile
    name: 10, // Deprecated in Appium 2.x
    'link text': 10, // Web-only, not for mobile
  };
  return priorityMap[strategy.toLowerCase()] ?? 7;
}

/**
 * Platform context inferred from locator strategy.
 */
function getLocatorPlatform(strategy: string): 'ios' | 'android' | 'both' | null {
  const lv = strategy.toLowerCase();
  if (lv.startsWith('-ios')) return 'ios';
  if (lv.startsWith('-android')) return 'android';
  if (lv === 'accessibility id' || lv === 'id' || lv === 'xpath' || lv === 'class name')
    return 'both';
  return null;
}

function scoreLocatorStability(
  strategy: string,
  value: string,
): { level: StabilityLevel; reason: string } {
  const lv = strategy.toLowerCase();

  // ── Accessibility ID: #1 recommended by Appium docs ──
  if (lv === 'accessibility id') {
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)) {
      return {
        level: 'fragile',
        reason: 'UUID in accessibility ID — dynamically generated, unreliable',
      };
    }
    return { level: 'stable', reason: '#1 recommended by Appium — portable across Android & iOS' };
  }

  // ── ID (resource-id on Android / bundled on iOS): #2 ──
  if (lv === 'id') {
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)) {
      return { level: 'fragile', reason: 'UUID in resource ID — dynamically generated' };
    }
    if (/\d{6,}/.test(value) && !value.includes(':id/')) {
      return {
        level: 'moderate',
        reason: 'Long numeric ID without package prefix — may not be unique',
      };
    }
    // Android resource ID pattern: com.package:id/element_name
    if (/^[a-z][a-z0-9.]+:id\//.test(value)) {
      return {
        level: 'stable',
        reason: 'Android resource-id with package prefix — #2 by Appium priority',
      };
    }
    return { level: 'stable', reason: 'Element ID — #2 by Appium 2.x recommended priority' };
  }

  // ── XPath: LAST RESORT — 10x slower on iOS per Appium docs ──
  if (lv === 'xpath') {
    // Absolute XPath (no descendant-or-self shorthand) — worst possible
    if (value.startsWith('/hierarchy') || (value.startsWith('/') && !value.startsWith('//'))) {
      return {
        level: 'very-fragile',
        reason: 'ABSOLUTE XPath — breaks on any layout change. Avoid entirely',
      };
    }
    if (/\[\d+\]/.test(value)) {
      return {
        level: 'very-fragile',
        reason: 'Index-based XPath [n] — breaks when element order changes',
      };
    }
    const slashCount = (value.match(/\//g) || []).length;
    if (slashCount > 7) {
      return {
        level: 'fragile',
        reason: `${slashCount}-level deep XPath — brittle to layout changes, 10x slower on iOS`,
      };
    }
    if (
      value.includes('@content-desc') ||
      value.includes('@resource-id') ||
      value.includes('@text')
    ) {
      return {
        level: 'moderate',
        reason: 'XPath with semantic attribute — more stable, but still prefer ID/accessibility id',
      };
    }
    return {
      level: 'fragile',
      reason: 'XPath is a LAST RESORT per Appium docs — 10x slower on iOS, breaks on UI changes',
    };
  }

  // ── iOS-native: Very fast and stable (iOS only) ──
  if (lv === '-ios predicate string') {
    return {
      level: 'stable',
      reason: 'iOS NSPredicate — native engine, excellent performance on iOS',
    };
  }
  if (lv === '-ios class chain') {
    return { level: 'stable', reason: 'iOS Class Chain — native iOS, faster than XPath' };
  }

  // ── Android UIAutomator2: Native, fast (Android only) ──
  if (lv === '-android uiautomator') {
    if (value.includes('resourceId') || value.includes('description')) {
      return {
        level: 'stable',
        reason: 'UIAutomator2 with resourceId/description — Android native, very reliable',
      };
    }
    if (value.includes('textContains') || value.includes('text(')) {
      return {
        level: 'moderate',
        reason: 'UIAutomator2 with text matching — breaks if copy changes',
      };
    }
    return {
      level: 'stable',
      reason: 'UIAutomator2 — Android native engine, preferred over XPath on Android',
    };
  }

  // ── Class name: Not unique, fragile ──
  if (lv === 'class name') {
    return {
      level: 'fragile',
      reason:
        'Class name alone is almost never unique — use with explicit index or prefer accessibility id',
    };
  }

  // ── name: DEPRECATED in Appium 2.x ──
  if (lv === 'name') {
    return {
      level: 'fragile',
      reason: '⚠️ Deprecated in Appium 2.x — replace with accessibility id or id',
    };
  }

  if (lv === 'link text') {
    return { level: 'moderate', reason: 'Text-based locator — breaks if copy/label changes' };
  }

  return { level: 'moderate', reason: 'Verify reliability for your target platform' };
}

// =====================================================================
// AI ENGINE 2: Code Generator (Multi-Framework, Appium 2.x aligned)
// References:
//   Java: io.appium:java-client:9.x + Selenium 4
//   Python: Appium-Python-Client 4.x
//   WebdriverIO: wdio/appium-service + @wdio/mobile-utils
//   JavaScript: webdriverio 8.x
// =====================================================================
type CodeFramework = 'java' | 'python' | 'javascript' | 'wdio';

function generateTestCode(
  node: InspectorNode,
  platform: 'android' | 'ios' | 'unknown',
  framework: CodeFramework,
  locator: LocatorSuggestion,
): string {
  const { strategy, value } = locator;
  const rawLabel =
    (node.text || node.name || node.type?.split('.').pop() || 'element')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/^_+/, '')
      .slice(0, 24) || 'element';
  const elementLabel = rawLabel.charAt(0).toLowerCase() + rawLabel.slice(1);

  const isInput =
    node.type?.toLowerCase().includes('edit') ||
    node.type?.toLowerCase().includes('input') ||
    node.type?.toLowerCase().includes('field') ||
    node.type?.toLowerCase().includes('textfield');

  const isScrollable =
    node.attributes?.scrollable === 'true' || node.attributes?.scrollable === true;

  const platformNote =
    strategy.toLowerCase().startsWith('-ios') && platform !== 'ios'
      ? '// ⚠️ -ios predicate/class chain ONLY work with XCUITest (iOS)\n'
      : strategy.toLowerCase().startsWith('-android') && platform !== 'android'
        ? '// ⚠️ -android uiautomator ONLY works with UIAutomator2 (Android)\n'
        : '';

  // Correct WebdriverIO mobile selector syntax per wdio docs
  const wdioSelector: Record<string, string> = {
    'accessibility id': `~${value}`, // Short form for accessibility id
    id:
      platform === 'ios'
        ? `-ios predicate string:label == "${value}"`
        : `android=new UiSelector().resourceId("${value}")`,
    xpath: `${value}`, // XPath works directly
    '-ios predicate string': `-ios predicate string:${value}`,
    '-ios class chain': `-ios class chain:${value}`,
    '-android uiautomator': `android=${value}`,
  };

  // Correct Appium Java Client 9.x patterns
  const javaBy: Record<string, string> = {
    'accessibility id': `AppiumBy.accessibilityId("${value}")`,
    id: `AppiumBy.id("${value}")`,
    xpath: `AppiumBy.xpath("${value}")`,
    '-ios predicate string': `AppiumBy.iOSNsPredicateString("${value}")`,
    '-ios class chain': `AppiumBy.iOSClassChain("${value}")`,
    '-android uiautomator': `AppiumBy.androidUIAutomator("${value}")`,
    'class name': `AppiumBy.className("${value}")`,
  };

  // Correct Appium Python Client 4.x patterns
  const pyBy: Record<string, string> = {
    'accessibility id': `AppiumBy.ACCESSIBILITY_ID, "${value}"`,
    id: `AppiumBy.ID, "${value}"`,
    xpath: `AppiumBy.XPATH, "${value}"`,
    '-ios predicate string': `AppiumBy.IOS_PREDICATE, "${value}"`,
    '-ios class chain': `AppiumBy.IOS_CLASS_CHAIN, "${value}"`,
    '-android uiautomator': `AppiumBy.ANDROID_UIAUTOMATOR, '${value}'`,
    'class name': `AppiumBy.CLASS_NAME, "${value}"`,
  };

  const jSel = javaBy[strategy.toLowerCase()];
  const pSel = pyBy[strategy.toLowerCase()];
  const wSel = wdioSelector[strategy.toLowerCase()];

  if (framework === 'java') {
    if (!jSel) return `// Strategy "${strategy}" not supported in Appium Java Client`;
    const driverType =
      platform === 'android' ? 'AndroidDriver' : platform === 'ios' ? 'IOSDriver' : 'AppiumDriver';
    const interaction = isScrollable
      ? '((Scrollable) element).scrollTo("target text");'
      : isInput
        ? 'element.clear();\n        element.sendKeys("your text here");'
        : 'element.click();';

    return `${platformNote}// Appium Java Client 9.x + Selenium 4 + TestNG
import io.appium.java_client.AppiumBy;
import io.appium.java_client.${driverType};
import org.openqa.selenium.WebElement;
import org.testng.annotations.Test;

@Test
public void test_${elementLabel}() {
    WebElement element = driver.findElement(${jSel});
    ${interaction}
    // Add assertions here via TestNG Assert or Hamcrest
}`;
  }

  if (framework === 'python') {
    if (!pSel) return `# Strategy "${strategy}" not supported in Appium Python Client`;
    const driverType =
      platform === 'android' ? 'AndroidDriver' : platform === 'ios' ? 'IOSDriver' : 'driver';
    const interaction = isInput
      ? 'element.clear()\n        element.send_keys("your text here")'
      : 'element.click()';

    return `${platformNote}# Appium Python Client 4.x + pytest
from appium.webdriver.common.appiumby import AppiumBy
import pytest

def test_${elementLabel}(self):
    element = self.driver.find_element(${pSel})
    ${interaction}
    # Add assertions here via assert or pytest.assert`;
  }

  if (framework === 'javascript') {
    if (!wSel) return `// Strategy "${strategy}" not supported in WebdriverIO mobile`;
    const interaction = isInput
      ? 'await element.clearValue();\n    await element.addValue("your text here");'
      : 'await element.click();';

    return `${platformNote}// WebdriverIO 9.x + @wdio/appium-service
describe('${elementLabel} test', () => {
  it('should interact with ${elementLabel}', async () => {
    const element = await $('${wSel}');
    await element.waitForDisplayed({ timeout: 5000 });
    ${interaction}
    // Add assertions here via expect(element)
  });
});`;
  }

  // wdio (same as js but with explicit driver reference)
  if (!wSel) return `// Strategy "${strategy}" not supported in WebdriverIO mobile`;
  const interaction = isInput
    ? 'await driver.$(\'target\').clearValue();\n  await element.addValue("your text here");'
    : 'await element.click();';

  return `${platformNote}// WebdriverIO 9.x standalone
const element = await driver.$('${wSel}');
await element.waitForExist({ timeout: 5000 });
${interaction}
// Assert with expect(element).toBeDisplayed()`;
}

/**
 * Sorts locators by the official Appium recommended priority:
 * accessibility id > id > iOS predicate > UIAutomator > class chain > xpath > deprecated
 */
function sortLocatorsByPriority(locators: LocatorSuggestion[]): LocatorSuggestion[] {
  return [...locators].sort(
    (a, b) => getLocatorPriority(a.strategy) - getLocatorPriority(b.strategy),
  );
}

// =====================================================================
// AI ENGINE 3: Element Insight (Client-side Semantic Analysis)
// =====================================================================
interface ElementInsight {
  role: string;
  description: string;
  interactable: boolean;
  bestLocator?: LocatorSuggestion;
  warning?: string;
  emoji: string;
}

function analyzeElement(node: InspectorNode): ElementInsight {
  const type = (node.type || '').toLowerCase();
  const isClickable = node.attributes?.clickable === 'true' || node.attributes?.clickable === true;
  const isEnabled = node.attributes?.enabled !== 'false' && node.attributes?.enabled !== false;
  const isScrollable =
    node.attributes?.scrollable === 'true' || node.attributes?.scrollable === true;
  const text = node.text || node.label || node.value || '';
  const childCount = node.children?.length || 0;

  // Determine semantic role
  let role = 'Element';
  let emoji = '📦';
  if (type.includes('button') || type.includes('btn') || (isClickable && childCount === 0)) {
    role = 'Button';
    emoji = '🔘';
  } else if (type.includes('edit') || type.includes('input') || type.includes('field')) {
    role = 'Text Input';
    emoji = '✏️';
  } else if (type.includes('image') || type.includes('img') || type.includes('imageview')) {
    role = 'Image';
    emoji = '🖼️';
  } else if (
    type.includes('scroll') ||
    type.includes('recyclerview') ||
    type.includes('listview') ||
    isScrollable
  ) {
    role = 'Scrollable List';
    emoji = '📜';
  } else if (type.includes('text') || type.includes('label')) {
    role = 'Text Label';
    emoji = '📝';
  } else if (type.includes('switch') || type.includes('toggle') || type.includes('checkbox')) {
    role = 'Toggle / Checkbox';
    emoji = '☑️';
  } else if (type.includes('nav') || type.includes('toolbar') || type.includes('tabbar')) {
    role = 'Navigation Bar';
    emoji = '🧭';
  } else if (childCount > 0) {
    role = `Container (${childCount} children)`;
    emoji = '🗂️';
  }

  const bestLocator =
    node.suggestedLocators?.find((l) => l.strategy === 'accessibility id' || l.strategy === 'id') ||
    node.suggestedLocators?.[0];

  const warning = !isEnabled
    ? '⚠️ Element is disabled'
    : node.rect?.width === 0 || node.rect?.height === 0
      ? '⚠️ Zero-size element — may not be interactable'
      : undefined;

  const textDesc = text ? ` with text "${text.slice(0, 30)}"` : '';
  const description = `This is a ${role.toLowerCase()}${textDesc}. ${isClickable ? 'It can be tapped/clicked.' : isScrollable ? 'It supports scrolling.' : 'It is a visual container.'}${childCount > 0 ? ` Contains ${childCount} child element${childCount > 1 ? 's' : ''}.` : ''}`;

  return { role, description, interactable: isClickable || isEnabled, bestLocator, warning, emoji };
}

// =====================================================================
// AI ENGINE 4: Smart Natural Language Search
// =====================================================================
function smartSearch(node: InspectorNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();

  // Semantic role mappings
  const semanticMap: Record<string, string[]> = {
    button: ['button', 'btn', 'clickable', 'tapable'],
    input: ['edittext', 'input', 'field', 'textfield', 'textinput', 'edit'],
    image: ['image', 'imageview', 'img', 'picture', 'photo', 'icon'],
    text: ['textview', 'label', 'text', 'statictext'],
    list: ['listview', 'recyclerview', 'scrollview', 'tableview', 'collectionview', 'scroll'],
    toggle: ['switch', 'checkbox', 'toggle', 'radiobutton'],
    nav: ['toolbar', 'navigationbar', 'tabbar', 'actionbar', 'navbar'],
  };

  const typeStr = (node.type || '').toLowerCase();
  const textStr = (node.text || node.label || node.value || '').toLowerCase();
  const nameStr = (node.name || '').toLowerCase();
  const attrsStr = Object.values(node.attributes || {})
    .join(' ')
    .toLowerCase();

  // Check semantic aliases
  for (const [alias, variants] of Object.entries(semanticMap)) {
    if (q.includes(alias) && variants.some((v) => typeStr.includes(v))) {
      return true;
    }
  }

  // Direct match on type, text, name, or attributes
  return typeStr.includes(q) || textStr.includes(q) || nameStr.includes(q) || attrsStr.includes(q);
}

// =====================================================================
// MAIN COMPONENT
// =====================================================================
const OmniInspector: React.FC<OmniInspectorProps> = ({ sessionId, udid, streamUrl, embedded = false }) => {
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<InspectorNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<InspectorNode | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['/']));
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedLocator, setCopiedLocator] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'code' | 'insight'>('info');
  const [codeFramework, setCodeFramework] = useState<CodeFramework>('java');
  const [selectedLocatorForCode, setSelectedLocatorForCode] = useState<LocatorSuggestion | null>(
    null,
  );
  const [naturalDimensions, setNaturalDimensions] = useState({ width: 0, height: 0 });
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
  const [streamError, setStreamError] = useState(false);
  const [inspectorMode, setInspectorMode] = useState<'inspect' | 'interact'>('inspect');
  // Per-locator test results, keyed by the locator strategy. Cleared when
  // the selected node changes so stale match badges don't follow you across
  // elements.
  const [locatorTests, setLocatorTests] = useState<Record<string, MatchResult>>({});
  const [activeLocatorTest, setActiveLocatorTest] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<HTMLImageElement>(null);
  const handleMouseDownRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const updateCanvasDimensions = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const availableWidth = rect.width;
    const availableHeight = rect.height;

    const rootRect = snapshot?.hierarchy?.rect;
    let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width || 1;
    let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height || 1;

    if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
      deviceW = rootRect.width;
      deviceH = rootRect.height;
    }

    const deviceRatio = deviceW / deviceH;
    let width, height;

    if (availableWidth / availableHeight > deviceRatio) {
      height = availableHeight;
      width = height * deviceRatio;
    } else {
      width = availableWidth;
      height = width / deviceRatio;
    }
    setCanvasDimensions({ width, height });
  }, [snapshot, naturalDimensions]);

  useEffect(() => {
    updateCanvasDimensions();
    window.addEventListener('resize', updateCanvasDimensions);
    return () => window.removeEventListener('resize', updateCanvasDimensions);
  }, [updateCanvasDimensions]);

  useEffect(() => {
    if (udid) loadSnapshot();
  }, [udid]);

  // Auto-select best locator when node changes
  useEffect(() => {
    if (selectedNode?.suggestedLocators?.length) {
      const best =
        selectedNode.suggestedLocators.find(
          (l) => l.strategy === 'accessibility id' || l.strategy === 'id',
        ) || selectedNode.suggestedLocators[0];
      setSelectedLocatorForCode(best);
    } else {
      setSelectedLocatorForCode(null);
    }
    setLocatorTests({});
    setActiveLocatorTest(null);
  }, [selectedNode]);

  const runLocatorTest = useCallback(
    (strategy: string, value: string) => {
      if (!snapshot?.hierarchy) return;
      const result = matchSelector(snapshot.hierarchy, strategy, value);
      setLocatorTests((prev) => ({ ...prev, [strategy]: result }));
      setActiveLocatorTest(strategy);
    },
    [snapshot],
  );

  const loadSnapshot = async () => {
    if (!udid) return;
    setLoading(true);
    setError(null);
    try {
      const data = await XenonApiService.getInspectorSnapshot(udid);
      setSnapshot(data);
      const expanded = new Set<string>(['/']);
      const expandLevel = (node: InspectorNode, level: number) => {
        if (level < 2) {
          expanded.add(node.xpath);
          node.children?.forEach((c) => expandLevel(c, level + 1));
        }
      };
      if (data.hierarchy) expandLevel(data.hierarchy, 0);
      setExpandedNodes(expanded);
    } catch (err: any) {
      setError(err.message || 'Failed to capture snapshot');
    } finally {
      setLoading(false);
    }
  };

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setNaturalDimensions({ width: naturalWidth, height: naturalHeight });
  };

  const onStreamError = () => setStreamError(true);

  const onStreamLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setStreamError(false);
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setNaturalDimensions({ width: naturalWidth, height: naturalHeight });
    }
  };

  const useStream = streamUrl && !streamError;

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (inspectorMode !== 'interact' || !udid) return;
    const rect = e.currentTarget.getBoundingClientRect();
    handleMouseDownRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      time: Date.now(),
    };
  };

  const handleMouseUp = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (inspectorMode !== 'interact' || !udid || !handleMouseDownRef.current) return;
    const start = handleMouseDownRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    const timeDiff = Date.now() - start.time;

    const containerWidth = canvasDimensions.width;
    const containerHeight = canvasDimensions.height;
    const rootRect = snapshot?.hierarchy?.rect;
    let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width;
    let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height;
    if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
      deviceW = rootRect.width;
      deviceH = rootRect.height;
    }

    if (!deviceW || !deviceH || containerWidth === 0 || containerHeight === 0) return;

    const mapToDevice = (vx: number, vy: number) => ({
      x: Math.round((vx / containerWidth) * deviceW),
      y: Math.round((vy / containerHeight) * deviceH),
      px: vx / containerWidth,
      py: vy / containerHeight,
    });

    const startDevice = mapToDevice(start.x, start.y);
    const endDevice = mapToDevice(endX, endY);
    const dist = Math.sqrt(Math.pow(endX - start.x, 2) + Math.pow(endY - start.y, 2));

    if (startDevice.px < 0 || startDevice.px > 1 || startDevice.py < 0 || startDevice.py > 1)
      return;

    try {
      if (timeDiff < 500 && dist < 10) {
        await XenonApiService.tap(udid, startDevice.x, startDevice.y);
      } else if (timeDiff >= 500 && dist < 10) {
        await XenonApiService.touchAndHold(udid, startDevice.x, startDevice.y, timeDiff);
      } else if (dist >= 10) {
        await XenonApiService.swipe(udid, startDevice.x, startDevice.y, endDevice.x, endDevice.y);
      }
    } catch (err) {
      console.error('Interaction failed:', err);
    }
    handleMouseDownRef.current = null;
  };

  const toggleExpand = (xpath: string) => {
    const next = new Set(expandedNodes);
    if (next.has(xpath)) next.delete(xpath);
    else next.add(xpath);
    setExpandedNodes(next);
  };

  const expandAll = () => {
    const all = new Set<string>();
    const collect = (n: InspectorNode) => {
      all.add(n.xpath);
      n.children?.forEach(collect);
    };
    if (snapshot?.hierarchy) collect(snapshot.hierarchy);
    setExpandedNodes(all);
  };

  const collapseAll = () => setExpandedNodes(new Set(['/']));

  const copyToClipboard = (text: string, strategy: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLocator(strategy);
    setTimeout(() => setCopiedLocator(null), 2000);
  };

  const countNodes = (node: InspectorNode): number => {
    let count = 1;
    node.children?.forEach((c) => (count += countNodes(c)));
    return count;
  };

  // Roll up element counts by semantic role for the default summary view.
  const summarizeByRole = (root: InspectorNode | undefined | null): Array<{ role: string; emoji: string; count: number }> => {
    if (!root) return [];
    const counts: Record<string, { emoji: string; count: number }> = {};
    const visit = (n: InspectorNode) => {
      const i = analyzeElement(n);
      const key = i.role.replace(/\s*\(.*?\)\s*/, '');
      if (!counts[key]) counts[key] = { emoji: i.emoji, count: 0 };
      counts[key].count += 1;
      n.children?.forEach(visit);
    };
    visit(root);
    return Object.entries(counts)
      .map(([role, v]) => ({ role, emoji: v.emoji, count: v.count }))
      .sort((a, b) => b.count - a.count);
  };

  const getElementPath = (node: InspectorNode): string[] => {
    const parts = node.xpath.split('/').filter(Boolean);
    return parts.slice(-3);
  };

  const renderTree = (node: InspectorNode, depth = 0): React.ReactNode => {
    if (!node) return null;
    const isExpanded = expandedNodes.has(node.xpath);
    const hasChildren = node.children?.length > 0;
    const isSelected = selectedNode?.xpath === node.xpath;
    const isHovered = hoveredNode?.xpath === node.xpath;
    const shortType = node.type?.split('.').pop() || 'Element';
    // Prefer accessible label/text/name over the raw type so the tree isn't
    // a wall of "XCUIElementTypeOther" rows. Only count it as "accessible"
    // if it's actually different from the type itself.
    const candidate = node.label || node.attributes?.['content-desc'] || node.attributes?.['resource-id'] || node.name;
    const accessibleLabel =
      typeof candidate === 'string' && candidate && candidate !== shortType && candidate !== node.type
        ? candidate
        : null;
    const displayName = accessibleLabel || shortType;

    // Smart search: uses natural language matching
    const matchesSearch = !searchQuery || smartSearch(node, searchQuery);

    if (!matchesSearch && !hasChildren) return null;
    // If searching, only show if this node or a descendant matches
    if (searchQuery && !matchesSearch) {
      const hasMatchingChild = (n: InspectorNode): boolean => {
        if (smartSearch(n, searchQuery)) return true;
        return n.children?.some(hasMatchingChild) || false;
      };
      if (!hasMatchingChild(node)) return null;
    }

    const insight = node === selectedNode ? null : null; // Only compute for selected

    return (
      <div key={node.xpath} className="tree-node">
        <div
          className={`tree-item ${isSelected ? 'selected' : ''} ${isHovered && !isSelected ? 'hovered' : ''}`}
          onClick={() => {
            setSelectedNode(node);
            setActiveTab('info');
          }}
          onMouseEnter={() => setHoveredNode(node)}
          onMouseLeave={() => setHoveredNode(null)}
        >
          <div className="tree-item-indent" style={{ width: `${depth * 14}px` }} />
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.xpath);
              }}
              className="tree-toggle"
            >
              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
          ) : (
            <span className="tree-toggle-spacer" />
          )}
          <Box size={11} className="tree-icon" />
          <span className="tree-label" title={`${shortType}${accessibleLabel ? ` — ${accessibleLabel}` : ''}`}>
            {displayName}
          </span>
          {accessibleLabel && (
            <span className="tree-type-tag" title={shortType}>
              {shortType}
            </span>
          )}
          {node.text && <span className="tree-text-preview">"{node.text.slice(0, 20)}"</span>}
          {hasChildren && <span className="tree-badge">{node.children.length}</span>}
        </div>
        {isExpanded && hasChildren && (
          <div className="tree-children">{node.children.map((c) => renderTree(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  const renderHighlights = (node: InspectorNode): React.ReactNode[] => {
    if (!naturalDimensions.width) return [];
    const nodes: React.ReactNode[] = [];
    const rootRect = snapshot?.hierarchy?.rect;
    let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width;
    let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height;

    if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
      deviceW = rootRect.width;
      deviceH = rootRect.height;
    }

    // Only leaf nodes get hit areas to prevent multi-highlight
    const processNode = (n: InspectorNode, depth: number) => {
      const isLeaf = !n.children || n.children.length === 0;
      if (n.rect?.width > 0 && n.rect?.height > 0 && isLeaf) {
        nodes.push(
          <div
            key={n.xpath}
            className="omni-hit-area"
            style={{
              left: `${(n.rect.x / deviceW) * 100}%`,
              top: `${(n.rect.y / deviceH) * 100}%`,
              width: `${(n.rect.width / deviceW) * 100}%`,
              height: `${(n.rect.height / deviceH) * 100}%`,
              zIndex: depth,
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedNode(n);
              setActiveTab('info');
            }}
            onMouseEnter={() => setHoveredNode(n)}
            onMouseLeave={() => setHoveredNode(null)}
          />,
        );
      }
      n.children?.forEach((c) => processNode(c, depth + 1));
    };
    if (snapshot?.hierarchy) processNode(snapshot.hierarchy, 1);
    return nodes;
  };

  const renderMatchFrames = (): React.ReactNode[] => {
    if (!activeLocatorTest || !naturalDimensions.width) return [];
    const result = locatorTests[activeLocatorTest];
    if (!result || result.kind !== 'matched' || result.nodes.length === 0) return [];
    const rootRect = snapshot?.hierarchy?.rect;
    let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width;
    let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height;
    if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
      deviceW = rootRect.width;
      deviceH = rootRect.height;
    }
    const matchClass =
      result.nodes.length === 1 ? 'omni-frame-match unique' : 'omni-frame-match multi';
    return result.nodes
      .filter((n) => n.rect && n.rect.width > 0 && n.rect.height > 0)
      .map((n, i) => (
        <div
          key={`match-${activeLocatorTest}-${i}`}
          className={matchClass}
          style={{
            left: `${(n.rect.x / deviceW) * 100}%`,
            top: `${(n.rect.y / deviceH) * 100}%`,
            width: `${(n.rect.width / deviceW) * 100}%`,
            height: `${(n.rect.height / deviceH) * 100}%`,
          }}
        />
      ));
  };

  const renderOverlayFrame = (node: InspectorNode | null, type: 'hover' | 'select') => {
    if (!node?.rect || !naturalDimensions.width) return null;
    const rootRect = snapshot?.hierarchy?.rect;
    let deviceW = snapshot?.metadata?.screenWidth || naturalDimensions.width;
    let deviceH = snapshot?.metadata?.screenHeight || naturalDimensions.height;
    if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
      deviceW = rootRect.width;
      deviceH = rootRect.height;
    }
    return (
      <div
        className={`omni-frame-${type}`}
        style={{
          left: `${(node.rect.x / deviceW) * 100}%`,
          top: `${(node.rect.y / deviceH) * 100}%`,
          width: `${(node.rect.width / deviceW) * 100}%`,
          height: `${(node.rect.height / deviceH) * 100}%`,
        }}
      />
    );
  };

  const totalElements = snapshot?.hierarchy ? countNodes(snapshot.hierarchy) : 0;
  const insight = selectedNode ? analyzeElement(selectedNode) : null;

  const stabilityLevelConfig: Record<StabilityLevel, { icon: React.ReactNode; cls: string }> = {
    stable: { icon: <ShieldCheck size={10} />, cls: 'stable' },
    moderate: { icon: <AlertTriangle size={10} />, cls: 'moderate' },
    fragile: { icon: <ShieldAlert size={10} />, cls: 'fragile' },
    'very-fragile': { icon: <ShieldAlert size={10} />, cls: 'very-fragile' },
  };

  const roleSummary = embedded && snapshot?.hierarchy ? summarizeByRole(snapshot.hierarchy) : [];

  return (
    <div className={`omni-inspector-container ${embedded ? 'omni-embedded' : ''}`}>
      <div className="omni-main-content">
        {/* ===== Left Panel: Device Preview (hidden in embedded mode) ===== */}
        {!embedded && (
        <div className="omni-screenshot-panel">
          <div className="omni-screenshot-header">
            <div className="omni-header-left">
              <span className="omni-screenshot-title">Device Preview</span>
              <div className="omni-mode-toggle">
                <button
                  className={`omni-mode-btn ${inspectorMode === 'inspect' ? 'active' : ''}`}
                  onClick={() => setInspectorMode('inspect')}
                  title="Inspection Mode (Highlight Elements)"
                >
                  <MousePointer2 size={12} />
                  <span>Inspect</span>
                </button>
                <button
                  className={`omni-mode-btn ${inspectorMode === 'interact' ? 'active' : ''}`}
                  onClick={() => setInspectorMode('interact')}
                  title="Interaction Mode (Direct Control)"
                >
                  <Touchpad size={12} />
                  <span>Interact</span>
                </button>
              </div>
            </div>
            <button className="omni-refresh-btn" onClick={loadSnapshot} disabled={loading}>
              <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Capturing...' : 'Refresh'}
            </button>
          </div>

          <div className="omni-screenshot-container" ref={containerRef}>
            {loading && !useStream && (
              <div className="omni-loading-overlay">
                <div className="omni-spinner" />
                <span>Capturing screen...</span>
              </div>
            )}
            {!snapshot && !loading && !useStream && (
              <div className="omni-empty-state">
                <Target size={40} />
                <span>Click Refresh to capture</span>
              </div>
            )}
            {useStream && (
              <div
                className={`omni-screenshot-wrapper ${inspectorMode === 'interact' ? 'interactable' : ''}`}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
              >
                <img
                  ref={streamRef}
                  src={streamUrl!}
                  onLoad={onStreamLoad}
                  onError={onStreamError}
                  className="omni-screenshot-img"
                  style={inspectorMode === 'interact' ? { pointerEvents: 'none' } : {}}
                  draggable={false}
                  alt="Live Device Stream"
                />
                {snapshot?.hierarchy && inspectorMode === 'inspect' && (
                  <div className="omni-overlay">
                    {renderHighlights(snapshot.hierarchy)}
                    {renderMatchFrames()}
                    {renderOverlayFrame(hoveredNode, 'hover')}
                    {renderOverlayFrame(selectedNode, 'select')}
                  </div>
                )}
              </div>
            )}
            {!useStream && snapshot?.screenshot && (
              <div
                className={`omni-screenshot-wrapper ${inspectorMode === 'interact' ? 'interactable' : ''}`}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
              >
                <img
                  ref={imgRef}
                  src={`data:image/png;base64,${snapshot.screenshot}`}
                  onLoad={onImageLoad}
                  className="omni-screenshot-img"
                  style={inspectorMode === 'interact' ? { pointerEvents: 'none' } : {}}
                  draggable={false}
                />
                {inspectorMode === 'inspect' && (
                  <div className="omni-overlay">
                    {renderHighlights(snapshot.hierarchy)}
                    {renderMatchFrames()}
                    {renderOverlayFrame(hoveredNode, 'hover')}
                    {renderOverlayFrame(selectedNode, 'select')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}

        {/* In embedded mode, expose a refresh button on the tree header instead. */}

        {/* ===== Center Panel: Source Tree ===== */}
        <div className="omni-tree-panel">
          <div className="omni-tree-header">
            <div className="omni-tree-title">
              <Layers size={14} />
              <span>Source</span>
              {totalElements > 0 && (
                <span className="omni-count-badge">{totalElements} elements</span>
              )}
            </div>
            <div className="omni-tree-actions">
              <button onClick={expandAll} className="omni-action-btn" title="Expand All">
                <Grid3x3 size={12} />
              </button>
              <button onClick={collapseAll} className="omni-action-btn" title="Collapse All">
                <Layout size={12} />
              </button>
              {embedded && (
                <button
                  onClick={loadSnapshot}
                  className="omni-action-btn"
                  title={loading ? 'Capturing…' : 'Refresh snapshot'}
                  disabled={loading}
                >
                  <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
          </div>
          <div className="omni-tree-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search elements... (try 'login button' or 'text field')"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search elements"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="omni-clear-btn">
                ×
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="omni-search-hint">
              <Sparkles size={10} /> Smart search active — try "button", "input", "image"
            </div>
          )}
          <div className="omni-tree-content">
            {snapshot?.hierarchy ? (
              renderTree(snapshot.hierarchy)
            ) : (
              <div className="omni-empty-state small">
                <span>No hierarchy loaded</span>
              </div>
            )}
          </div>
        </div>

        {/* ===== Right Panel: AI-Powered Details ===== */}
        <div className="omni-details-panel">
          {/* Tab header */}
          <div className="omni-details-tabs" role="tablist">
            <button
              className={`omni-details-tab ${activeTab === 'info' ? 'active' : ''}`}
              onClick={() => setActiveTab('info')}
              role="tab"
              aria-selected={activeTab === 'info'}
            >
              <MapPin size={12} /> <span>Info</span>
            </button>
            <button
              className={`omni-details-tab ${activeTab === 'insight' ? 'active' : ''}`}
              onClick={() => setActiveTab('insight')}
              disabled={!selectedNode}
              title="AI Element Analysis"
              role="tab"
              aria-selected={activeTab === 'insight'}
            >
              <Lightbulb size={12} /> <span>AI Insight</span>
            </button>
            <button
              className={`omni-details-tab ${activeTab === 'code' ? 'active' : ''}`}
              onClick={() => setActiveTab('code')}
              disabled={!selectedNode}
              title="Generate Test Code"
              role="tab"
              aria-selected={activeTab === 'code'}
            >
              <Code2 size={12} /> <span>Code Gen</span>
            </button>
          </div>

          <div className="omni-details-content">
            {!selectedNode ? (
              snapshot?.hierarchy ? (
                <div className="omni-summary-panel">
                  <div className="omni-summary-hero">
                    <Target size={28} />
                    <div>
                      <div className="omni-summary-title">No element selected</div>
                      <div className="omni-summary-subtitle">
                        Click any node in the tree (or use Inspect mode on the device) to drill in.
                      </div>
                    </div>
                  </div>

                  <div className="omni-section">
                    <div className="omni-section-header">Snapshot Stats</div>
                    <div className="omni-summary-stats">
                      <div className="omni-summary-stat">
                        <span className="omni-summary-stat__label">Elements</span>
                        <span className="omni-summary-stat__value">{totalElements}</span>
                      </div>
                      <div className="omni-summary-stat">
                        <span className="omni-summary-stat__label">Width</span>
                        <span className="omni-summary-stat__value">
                          {snapshot.metadata?.screenWidth ?? naturalDimensions.width ?? '—'}
                        </span>
                      </div>
                      <div className="omni-summary-stat">
                        <span className="omni-summary-stat__label">Height</span>
                        <span className="omni-summary-stat__value">
                          {snapshot.metadata?.screenHeight ?? naturalDimensions.height ?? '—'}
                        </span>
                      </div>
                      <div className="omni-summary-stat">
                        <span className="omni-summary-stat__label">Platform</span>
                        <span className="omni-summary-stat__value">
                          {snapshot.platform || '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {roleSummary.length > 0 && (
                    <div className="omni-section">
                      <div className="omni-section-header">By Role</div>
                      <div className="omni-summary-roles">
                        {roleSummary.slice(0, 8).map((r) => (
                          <div key={r.role} className="omni-summary-role">
                            <span className="omni-summary-role__emoji">{r.emoji}</span>
                            <span className="omni-summary-role__name">{r.role}</span>
                            <span className="omni-summary-role__count">{r.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="omni-empty-state">
                  <Target size={32} />
                  <span>
                    {loading ? 'Capturing snapshot…' : 'Select an element from the tree or screenshot'}
                  </span>
                </div>
              )
            ) : (
              <>
                {/* === TAB: INFO === */}
                {activeTab === 'info' && (
                  <>
                    <div className="omni-section">
                      <div className="omni-section-header">Element Info</div>
                      <div className="omni-info-table">
                        <div className="omni-info-row">
                          <span className="omni-info-key">Type</span>
                          <span className="omni-info-value mono">{selectedNode.type}</span>
                        </div>
                        {selectedNode.text && (
                          <div className="omni-info-row">
                            <span className="omni-info-key">Text</span>
                            <span className="omni-info-value">{selectedNode.text}</span>
                          </div>
                        )}
                        <div className="omni-info-row">
                          <span className="omni-info-key">Path</span>
                          <span className="omni-info-value mono small">
                            {getElementPath(selectedNode).join(' › ')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="omni-section">
                      <div className="omni-section-header">Layout</div>
                      <div className="omni-layout-grid">
                        {['x', 'y', 'width', 'height'].map((k) => (
                          <div className="omni-layout-item" key={k}>
                            <span className="omni-layout-label">{k.toUpperCase()}</span>
                            <span className="omni-layout-value">
                              {(selectedNode.rect as any)[k]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="omni-section">
                      <div className="omni-section-header">
                        Locators
                        <span className="omni-section-badge">Stability Scored</span>
                      </div>
                      <div className="omni-locators-list">
                        {selectedNode.suggestedLocators?.map((loc) => {
                          const stability = scoreLocatorStability(loc.strategy, loc.value);
                          const cfg = stabilityLevelConfig[stability.level];
                          const test = locatorTests[loc.strategy];
                          let matchBadge: React.ReactNode = null;
                          if (test) {
                            if (test.kind === 'unsupported') {
                              matchBadge = (
                                <span
                                  className="omni-match-badge unsupported"
                                  title={test.reason || 'Cannot evaluate without a real driver'}
                                >
                                  <HelpCircle size={10} /> preview unavailable
                                </span>
                              );
                            } else if (test.nodes.length === 0) {
                              matchBadge = (
                                <span className="omni-match-badge zero" title="No element matches this selector in the current snapshot">
                                  <ShieldAlert size={10} /> 0 matches
                                </span>
                              );
                            } else if (test.nodes.length === 1) {
                              matchBadge = (
                                <span className="omni-match-badge unique" title="Selector is unique in the current snapshot">
                                  <ShieldCheck size={10} /> unique
                                </span>
                              );
                            } else {
                              matchBadge = (
                                <span
                                  className="omni-match-badge multi"
                                  title={`${test.nodes.length} elements match — selector is not unique`}
                                >
                                  <AlertTriangle size={10} /> {test.nodes.length} matches
                                </span>
                              );
                            }
                          }
                          return (
                            <div
                              key={loc.strategy}
                              className={`omni-locator-row ${selectedLocatorForCode?.strategy === loc.strategy ? 'selected-for-code' : ''}`}
                              onClick={() => setSelectedLocatorForCode(loc)}
                              title="Click to use in Code Generator"
                            >
                              <div className="omni-locator-left">
                                <div className="omni-locator-top">
                                  <span className="omni-locator-strategy">{loc.strategy}</span>
                                  <span
                                    className={`omni-stability-badge ${cfg.cls}`}
                                    title={stability.reason}
                                  >
                                    {cfg.icon}
                                    {stability.level}
                                  </span>
                                  {matchBadge}
                                </div>
                                <code className="omni-locator-value">{loc.value}</code>
                                <span className="omni-stability-reason">{stability.reason}</span>
                              </div>
                              <div className="omni-locator-actions">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    runLocatorTest(loc.strategy, loc.value);
                                  }}
                                  className={`omni-test-btn ${activeLocatorTest === loc.strategy ? 'active' : ''}`}
                                  title="Test this locator against the current snapshot"
                                >
                                  <Crosshair size={12} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(loc.value, loc.strategy);
                                  }}
                                  className={`omni-copy-btn ${copiedLocator === loc.strategy ? 'copied' : ''}`}
                                >
                                  {copiedLocator === loc.strategy ? (
                                    <Check size={12} />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="omni-section">
                      <div className="omni-section-header">Attributes</div>
                      <div className="omni-attributes-table">
                        {Object.entries(selectedNode.attributes || {})
                          .filter(([_, v]) => v != null && v !== '')
                          .map(([key, value]) => (
                            <div key={key} className="omni-attr-row">
                              <span className="omni-attr-key">{key}</span>
                              <span className="omni-attr-value">{String(value)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </>
                )}

                {/* === TAB: AI INSIGHT === */}
                {activeTab === 'insight' && insight && (
                  <div className="omni-insight-panel">
                    <div className="omni-insight-role">
                      <span className="omni-insight-emoji">{insight.emoji}</span>
                      <div>
                        <div className="omni-insight-role-name">{insight.role}</div>
                        <div className="omni-insight-interactable">
                          {insight.interactable ? (
                            <span className="omni-badge-green">
                              <Zap size={10} /> Interactable
                            </span>
                          ) : (
                            <span className="omni-badge-gray">Visual Only</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {insight.warning && (
                      <div className="omni-insight-warning">{insight.warning}</div>
                    )}

                    <div className="omni-insight-description">
                      <Sparkles size={12} className="omni-insight-icon" />
                      <p>{insight.description}</p>
                    </div>

                    {insight.bestLocator && (
                      <div className="omni-insight-best-locator">
                        <div className="omni-section-header">Recommended Locator</div>
                        <div className="omni-locator-row">
                          <div className="omni-locator-left">
                            <span className="omni-locator-strategy">
                              {insight.bestLocator.strategy}
                            </span>
                            <code className="omni-locator-value">{insight.bestLocator.value}</code>
                          </div>
                          <button
                            onClick={() => copyToClipboard(insight.bestLocator!.value, 'best')}
                            className={`omni-copy-btn ${copiedLocator === 'best' ? 'copied' : ''}`}
                          >
                            {copiedLocator === 'best' ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="omni-insight-attributes">
                      <div className="omni-section-header">Quick Facts</div>
                      <div className="omni-quick-facts">
                        {[
                          { label: 'Clickable', value: selectedNode.attributes?.clickable },
                          { label: 'Enabled', value: selectedNode.attributes?.enabled },
                          { label: 'Scrollable', value: selectedNode.attributes?.scrollable },
                          { label: 'Focusable', value: selectedNode.attributes?.focusable },
                          { label: 'Children', value: selectedNode.children?.length || 0 },
                        ].map(({ label, value }) => (
                          <div key={label} className="omni-quick-fact-row">
                            <span className="omni-quick-fact-label">{label}</span>
                            <span
                              className={`omni-quick-fact-value ${value === 'true' || value === true ? 'true' : ''}`}
                            >
                              {String(value ?? '—')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* === TAB: CODE GENERATOR === */}
                {activeTab === 'code' && (
                  <div className="omni-codegen-panel">
                    <div className="omni-codegen-frameworks">
                      {(['java', 'python', 'javascript', 'wdio'] as CodeFramework[]).map((fw) => (
                        <button
                          key={fw}
                          className={`omni-fw-btn ${codeFramework === fw ? 'active' : ''}`}
                          onClick={() => setCodeFramework(fw)}
                        >
                          {fw === 'java'
                            ? '☕ Java'
                            : fw === 'python'
                              ? '🐍 Python'
                              : fw === 'javascript'
                                ? '🟨 JS'
                                : '🔷 WD.io'}
                        </button>
                      ))}
                    </div>

                    {selectedLocatorForCode ? (
                      <>
                        <div className="omni-codegen-locator-selector">
                          <span className="omni-codegen-label">Locator:</span>
                          <select
                            value={selectedLocatorForCode.strategy}
                            onChange={(e) => {
                              const loc = selectedNode.suggestedLocators?.find(
                                (l) => l.strategy === e.target.value,
                              );
                              if (loc) setSelectedLocatorForCode(loc);
                            }}
                            className="omni-fw-select"
                          >
                            {selectedNode.suggestedLocators?.map((l) => (
                              <option key={l.strategy} value={l.strategy}>
                                {l.strategy} — {scoreLocatorStability(l.strategy, l.value).level}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="omni-codegen-output">
                          <div className="omni-codegen-header">
                            <span className="omni-codegen-lang">
                              {codeFramework === 'java'
                                ? 'Java / TestNG'
                                : codeFramework === 'python'
                                  ? 'Python / unittest'
                                  : codeFramework === 'javascript'
                                    ? 'JavaScript / Mocha'
                                    : 'WebdriverIO'}
                            </span>
                            <button
                              className="omni-copy-btn"
                              onClick={() =>
                                copyToClipboard(
                                  generateTestCode(
                                    selectedNode,
                                    snapshot?.platform === 'android'
                                      ? 'android'
                                      : snapshot?.platform === 'ios'
                                        ? 'ios'
                                        : 'unknown',
                                    codeFramework,
                                    selectedLocatorForCode!,
                                  ),
                                  'code',
                                )
                              }
                            >
                              {copiedLocator === 'code' ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                          <pre className="omni-codegen-pre">
                            <code>
                              {generateTestCode(
                                selectedNode,
                                snapshot?.platform === 'android'
                                  ? 'android'
                                  : snapshot?.platform === 'ios'
                                    ? 'ios'
                                    : 'unknown',
                                codeFramework,
                                selectedLocatorForCode!,
                              )}
                            </code>
                          </pre>
                        </div>
                      </>
                    ) : (
                      <div className="omni-empty-state small">
                        <Code2 size={24} />
                        <span>No locators available for this element</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OmniInspector;
