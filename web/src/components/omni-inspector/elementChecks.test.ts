import { describe, expect, it } from 'vitest';
import type { InspectorNode, LocatorSuggestion } from './OmniInspector';
import { checkSummary, elementChecks, isInteractive, type ElementCheck } from './elementChecks';

const loc = (strategy: string, value: string): LocatorSuggestion => ({
  strategy,
  value,
  unique: true,
  score: 0,
});

let n = 0;
function node(over: Partial<InspectorNode> = {}): InspectorNode {
  n += 1;
  return {
    name: '',
    type: 'android.widget.Button',
    text: 'Log in',
    rect: { x: 10, y: 10, width: 200, height: 60 },
    xpath: `/n${n}`,
    suggestedLocators: [],
    suggestedActions: [],
    children: [],
    attributes: { clickable: 'true', enabled: 'true' },
    ...over,
  };
}

function snap(children: InspectorNode[], metadata = { screenWidth: 1080, screenHeight: 2220 }) {
  const hierarchy = node({
    type: 'hierarchy',
    xpath: '/',
    text: '',
    attributes: {},
    children,
  });
  return { hierarchy, metadata };
}

const find = (checks: ElementCheck[], id: ElementCheck['id']) => checks.find((c) => c.id === id);

describe('elementChecks — unique locator', () => {
  it('passes when the best locator matches only this element', () => {
    const el = node({
      attributes: { clickable: 'true', 'resource-id': 'com.app:id/login' },
      suggestedLocators: [
        loc('xpath', '//android.widget.Button[1]'),
        loc('id', 'com.app:id/login'),
      ],
    });
    const c = find(elementChecks(el, snap([el])), 'unique');
    expect(c?.status).toBe('pass');
    expect(c?.detail).toBe('id com.app:id/login matches only this element');
  });

  it('fails when it matches several, and suggests a locator that is unique', () => {
    const a = node({
      attributes: {
        clickable: 'true',
        'resource-id': 'com.app:id/row',
        'content-desc': 'First row',
      },
      suggestedLocators: [loc('id', 'com.app:id/row'), loc('accessibility id', 'First row')],
    });
    const b = node({ attributes: { clickable: 'true', 'resource-id': 'com.app:id/row' } });
    const c = find(elementChecks(a, snap([a, b])), 'unique');
    // accessibility id outranks id, so it is the best locator and is unique.
    expect(c?.status).toBe('pass');

    const onlyId = {
      ...a,
      suggestedLocators: [loc('id', 'com.app:id/row'), loc('xpath', a.xpath)],
    };
    const d = find(elementChecks(onlyId, snap([onlyId, b])), 'unique');
    expect(d?.status).toBe('fail');
    expect(d?.detail).toMatch(/^id com\.app:id\/row matches 2 elements/);
  });

  it('fails when the best locator matches nothing in the capture', () => {
    const el = node({ suggestedLocators: [loc('id', 'com.app:id/gone')] });
    expect(find(elementChecks(el, snap([el])), 'unique')?.detail).toBe(
      'id com.app:id/gone matches nothing in this capture',
    );
  });

  it('says when a strategy can’t be checked here', () => {
    const el = node({
      suggestedLocators: [loc('-android uiautomator', 'new UiSelector().text("Log in")')],
    });
    const c = find(elementChecks(el, snap([el])), 'unique');
    expect(c?.status).toBe('info');
    expect(c?.detail).toBe('Can’t check -android uiautomator locators here');
  });

  it('fails when no locator is suggested', () => {
    const el = node({ suggestedLocators: [] });
    expect(find(elementChecks(el, snap([el])), 'unique')).toMatchObject({
      status: 'fail',
      detail: 'No locator suggested',
    });
  });
});

describe('elementChecks — stable locator', () => {
  it('passes a stable id with the scorer’s reason', () => {
    const el = node({
      attributes: { clickable: 'true', 'resource-id': 'com.app:id/login' },
      suggestedLocators: [loc('id', 'com.app:id/login')],
    });
    const c = find(elementChecks(el, snap([el])), 'stable');
    expect(c?.status).toBe('pass');
    expect(c?.detail.length).toBeGreaterThan(0);
  });

  it('warns about an index-based XPath', () => {
    const el = node({
      suggestedLocators: [loc('xpath', '/hierarchy/android.widget.FrameLayout[1]')],
    });
    expect(find(elementChecks(el, snap([el])), 'stable')?.status).toBe('warn');
  });
});

describe('isInteractive and the interactive check', () => {
  it('counts what a user can act on', () => {
    expect(isInteractive(node({ attributes: { clickable: 'true' } }))).toBe(true);
    expect(isInteractive(node({ attributes: { checkable: true } }))).toBe(true);
    expect(isInteractive(node({ attributes: { scrollable: 'true' } }))).toBe(true);
    expect(isInteractive(node({ attributes: { 'long-clickable': 'true' } }))).toBe(true);
    expect(isInteractive(node({ type: 'android.widget.EditText', attributes: {} }))).toBe(true);
    expect(
      isInteractive(node({ type: 'XCUIElementTypeButton', attributes: { enabled: 'true' } })),
    ).toBe(true);
  });

  // The old "Interactable" badge was clickable || enabled: every enabled
  // container qualified.
  it('does not count an element just because it is enabled', () => {
    const box = node({
      type: 'android.widget.FrameLayout',
      text: '',
      attributes: { enabled: 'true', clickable: 'false' },
    });
    expect(isInteractive(box)).toBe(false);
    const c = find(elementChecks(box, snap([box])), 'interactive');
    expect(c?.status).toBe('info');
    expect(c?.detail).toBe('Not interactive — a tap here goes to whatever is under it');
  });
});

describe('elementChecks — enabled, size, on screen', () => {
  it('fails a disabled element', () => {
    const el = node({ attributes: { clickable: 'true', enabled: 'false' } });
    expect(find(elementChecks(el, snap([el])), 'enabled')).toMatchObject({
      status: 'fail',
      detail: 'Disabled — taps are ignored',
    });
  });

  it('fails a zero-size element', () => {
    const el = node({ rect: { x: 10, y: 10, width: 0, height: 60 } });
    expect(find(elementChecks(el, snap([el])), 'size')?.status).toBe('fail');
  });

  it('warns about elements partly or fully off screen', () => {
    const inside = node();
    const partly = node({ rect: { x: 1000, y: 10, width: 200, height: 60 } });
    const off = node({ rect: { x: 10, y: 2400, width: 200, height: 60 } });
    const s = snap([inside, partly, off]);
    expect(find(elementChecks(inside, s), 'onscreen')?.status).toBe('pass');
    expect(find(elementChecks(partly, s), 'onscreen')?.detail).toBe(
      'Partly off screen — scroll it into view first',
    );
    expect(find(elementChecks(off, s), 'onscreen')?.detail).toBe(
      'Off screen — scroll it into view first',
    );
  });

  it('leaves out the screen check when the capture has no screen size', () => {
    const el = node();
    const s = snap([el], { screenWidth: 0, screenHeight: 0 });
    expect(find(elementChecks(el, s), 'onscreen')).toBeUndefined();
  });
});

describe('elementChecks — accessible name', () => {
  it('warns about an interactive element with no name', () => {
    const el = node({ text: '', attributes: { clickable: 'true' } });
    expect(find(elementChecks(el, snap([el])), 'name')?.status).toBe('warn');
  });

  it('accepts text, content-desc or an iOS label', () => {
    expect(find(elementChecks(node(), snap([])), 'name')?.status).toBe('pass');
    const desc = node({ text: '', attributes: { clickable: 'true', 'content-desc': 'Close' } });
    expect(find(elementChecks(desc, snap([desc])), 'name')?.status).toBe('pass');
    const ios = node({ type: 'XCUIElementTypeButton', text: '', label: 'Done', attributes: {} });
    expect(find(elementChecks(ios, snap([ios])), 'name')?.status).toBe('pass');
  });

  it('is left out for elements that aren’t interactive', () => {
    const box = node({
      type: 'android.widget.FrameLayout',
      text: '',
      attributes: { clickable: 'false' },
    });
    expect(find(elementChecks(box, snap([box])), 'name')).toBeUndefined();
  });
});

describe('elementChecks order and checkSummary', () => {
  it('lists the checks in a fixed order', () => {
    const el = node({
      attributes: { clickable: 'true', 'resource-id': 'com.app:id/login' },
      suggestedLocators: [loc('id', 'com.app:id/login')],
    });
    expect(elementChecks(el, snap([el])).map((c) => c.id)).toEqual([
      'unique',
      'stable',
      'interactive',
      'enabled',
      'size',
      'onscreen',
      'name',
    ]);
  });

  it('counts passes, warnings and failures (info counts as neither)', () => {
    const checks: ElementCheck[] = [
      { id: 'unique', label: '', status: 'pass', detail: '' },
      { id: 'stable', label: '', status: 'warn', detail: '' },
      { id: 'interactive', label: '', status: 'info', detail: '' },
      { id: 'enabled', label: '', status: 'fail', detail: '' },
      { id: 'size', label: '', status: 'pass', detail: '' },
    ];
    expect(checkSummary(checks)).toEqual({ pass: 2, warn: 1, fail: 1 });
  });
});
