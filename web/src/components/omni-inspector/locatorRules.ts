import type { LocatorSuggestion } from './OmniInspector';

// =====================================================================
// Locator rules: priority and stability scoring (Appium 2.x best practices)
// Based on official Appium docs: https://appium.io/docs/en/latest/guides/locator-strategies/
// XPath is ~10x slower on iOS. accessibility id is ALWAYS preferred.
// =====================================================================
export type StabilityLevel = 'stable' | 'moderate' | 'fragile' | 'very-fragile';

/**
 * Returns a priority rank for Appium locator strategies (lower = better).
 * Aligned with official Appium 2.x recommended priority.
 */
export function getLocatorPriority(strategy: string): number {
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
export function getLocatorPlatform(strategy: string): 'ios' | 'android' | 'both' | null {
  const lv = strategy.toLowerCase();
  if (lv.startsWith('-ios')) return 'ios';
  if (lv.startsWith('-android')) return 'android';
  if (lv === 'accessibility id' || lv === 'id' || lv === 'xpath' || lv === 'class name')
    return 'both';
  return null;
}

export function scoreLocatorStability(
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

/**
 * Sorts locators by the official Appium recommended priority:
 * accessibility id > id > iOS predicate > UIAutomator > class chain > xpath > deprecated
 */
export function sortLocatorsByPriority(locators: LocatorSuggestion[]): LocatorSuggestion[] {
  return [...locators].sort(
    (a, b) => getLocatorPriority(a.strategy) - getLocatorPriority(b.strategy),
  );
}
