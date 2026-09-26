import type { InspectorNode, InspectorSnapshot } from './OmniInspector';
import { scoreLocatorStability, sortLocatorsByPriority } from './locatorRules';
import { matchSelector } from './selector-matcher';

/**
 * Checks for the selected element: rules that run here, in the browser, on
 * the capture. The tab they replace was called "AI Insight", but nothing in
 * it was AI; it restated Info in prose and called any enabled element
 * "Interactable".
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export type CheckId =
  | 'unique'
  | 'stable'
  | 'interactive'
  | 'enabled'
  | 'size'
  | 'onscreen'
  | 'name';

export interface ElementCheck {
  id: CheckId;
  label: string;
  status: CheckStatus;
  detail: string;
}

type Capture = Pick<InspectorSnapshot, 'hierarchy' | 'metadata'>;

const isTrue = (v: unknown) => v === true || v === 'true';

// iOS reports control types rather than a clickable flag.
const IOS_CONTROL =
  /^XCUIElementType(Button|Cell|Switch|Slider|TextField|SecureTextField|SearchField|TextView|Link|Tab|SegmentedControl|Stepper|PickerWheel|Key|MenuItem)$/;
const ANDROID_EDITABLE = /(EditText|AutoCompleteTextView)$/;

/** Something a user can act on. Being enabled alone doesn't count. */
export function isInteractive(node: InspectorNode): boolean {
  const a = node.attributes || {};
  return (
    isTrue(a.clickable) ||
    isTrue(a['long-clickable']) ||
    isTrue(a.checkable) ||
    isTrue(a.scrollable) ||
    ANDROID_EDITABLE.test(node.type || '') ||
    IOS_CONTROL.test(node.type || '')
  );
}

function accessibleName(node: InspectorNode): string {
  const a = node.attributes || {};
  return String(node.text || a['content-desc'] || node.label || a.label || a.name || '').trim();
}

function uniqueCheck(node: InspectorNode, capture: Capture): ElementCheck {
  const label = 'Unique locator';
  const ranked = sortLocatorsByPriority(node.suggestedLocators || []);
  const best = ranked[0];
  if (!best) return { id: 'unique', label, status: 'fail', detail: 'No locator suggested' };

  const result = matchSelector(capture.hierarchy, best.strategy, best.value);
  const name = `${best.strategy} ${best.value}`;
  if (result.kind === 'unsupported') {
    return {
      id: 'unique',
      label,
      status: 'info',
      detail: `Can’t check ${best.strategy} locators here`,
    };
  }
  const onlyThis = (nodes: InspectorNode[]) => nodes.length === 1 && nodes[0].xpath === node.xpath;
  if (onlyThis(result.nodes)) {
    return { id: 'unique', label, status: 'pass', detail: `${name} matches only this element` };
  }

  const alternative = ranked.slice(1).find((l) => {
    const r = matchSelector(capture.hierarchy, l.strategy, l.value);
    return r.kind === 'matched' && onlyThis(r.nodes);
  });
  const instead = alternative ? `; use ${alternative.strategy} ${alternative.value} instead` : '';
  const count = result.nodes.length;
  const what = count === 0 ? 'matches nothing in this capture' : `matches ${count} elements`;
  return { id: 'unique', label, status: 'fail', detail: `${name} ${what}${instead}` };
}

function stableCheck(node: InspectorNode): ElementCheck | null {
  const best = sortLocatorsByPriority(node.suggestedLocators || [])[0];
  if (!best) return null;
  const { level, reason } = scoreLocatorStability(best.strategy, best.value);
  const ok = level === 'stable' || level === 'moderate';
  return { id: 'stable', label: 'Stable locator', status: ok ? 'pass' : 'warn', detail: reason };
}

function onScreenCheck(node: InspectorNode, capture: Capture): ElementCheck | null {
  const { screenWidth: w, screenHeight: h } = capture.metadata || {
    screenWidth: 0,
    screenHeight: 0,
  };
  if (!w || !h) return null;
  const { x, y, width, height } = node.rect;
  const label = 'On screen';
  const fullyOff = x + width <= 0 || y + height <= 0 || x >= w || y >= h;
  if (fullyOff) {
    return {
      id: 'onscreen',
      label,
      status: 'warn',
      detail: 'Off screen — scroll it into view first',
    };
  }
  const partly = x < 0 || y < 0 || x + width > w || y + height > h;
  if (partly) {
    return {
      id: 'onscreen',
      label,
      status: 'warn',
      detail: 'Partly off screen — scroll it into view first',
    };
  }
  return { id: 'onscreen', label, status: 'pass', detail: 'Fully inside the screen' };
}

/** The checks for one element, in a fixed order; some are left out when they don't apply. */
export function elementChecks(node: InspectorNode, capture: Capture): ElementCheck[] {
  const interactive = isInteractive(node);
  const enabled = !(node.attributes?.enabled === false || node.attributes?.enabled === 'false');
  const sized = node.rect.width > 0 && node.rect.height > 0;
  const name = accessibleName(node);

  const checks: (ElementCheck | null)[] = [
    uniqueCheck(node, capture),
    stableCheck(node),
    interactive
      ? {
          id: 'interactive',
          label: 'Interactive',
          status: 'pass',
          detail: 'Can be tapped, typed into or scrolled',
        }
      : {
          id: 'interactive',
          label: 'Interactive',
          status: 'info',
          detail: 'Not interactive — a tap here goes to whatever is under it',
        },
    enabled
      ? { id: 'enabled', label: 'Enabled', status: 'pass', detail: 'Enabled' }
      : { id: 'enabled', label: 'Enabled', status: 'fail', detail: 'Disabled — taps are ignored' },
    sized
      ? {
          id: 'size',
          label: 'Has size',
          status: 'pass',
          detail: `${node.rect.width} × ${node.rect.height}`,
        }
      : {
          id: 'size',
          label: 'Has size',
          status: 'fail',
          detail: 'Zero-size — it can’t be tapped or seen',
        },
    onScreenCheck(node, capture),
    !interactive
      ? null
      : name
        ? { id: 'name', label: 'Accessible name', status: 'pass', detail: `“${name.slice(0, 40)}”` }
        : {
            id: 'name',
            label: 'Accessible name',
            status: 'warn',
            detail:
              'No accessible name — screen readers and accessibility-id locators have nothing to use',
          },
  ];
  return checks.filter((c): c is ElementCheck => c !== null);
}

/** Passes, warnings and failures; info rows count as neither. */
export function checkSummary(checks: ElementCheck[]): { pass: number; warn: number; fail: number } {
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };
}
