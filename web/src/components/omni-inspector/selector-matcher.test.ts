import { describe, it, expect } from 'vitest';
import { matchSelector } from './selector-matcher';
import type { InspectorNode } from './OmniInspector';

const node = (
  type: string,
  attrs: Record<string, any> = {},
  children: InspectorNode[] = [],
): InspectorNode => ({
  name: attrs.name || type,
  type,
  rect: { x: 0, y: 0, width: 100, height: 50 },
  xpath: '/',
  suggestedLocators: [],
  suggestedActions: [],
  children,
  attributes: attrs,
});

const tree: InspectorNode = node('XCUIElementTypeApplication', {}, [
  node('XCUIElementTypeWindow', {}, [
    node('XCUIElementTypeOther', { label: 'Header' }, [
      node('XCUIElementTypeButton', { name: 'login-submit', label: 'Submit' }),
      node('XCUIElementTypeButton', { name: 'login-submit', label: 'Submit' }),
    ]),
    node('XCUIElementTypeOther', { 'resource-id': 'com.app:id/footer' }, [
      node('XCUIElementTypeStaticText', { name: 'help-text', value: 'Help' }),
    ]),
  ]),
]);

describe('matchSelector', () => {
  it('finds all elements matching an accessibility id', () => {
    const r = matchSelector(tree, 'accessibility id', 'login-submit');
    expect(r.kind).to.equal('matched');
    expect(r.nodes).to.have.lengthOf(2);
  });

  it('returns empty for unknown accessibility id', () => {
    const r = matchSelector(tree, 'accessibility id', 'no-such-thing');
    expect(r.kind).to.equal('matched');
    expect(r.nodes).to.have.lengthOf(0);
  });

  it('finds elements by resource id', () => {
    const r = matchSelector(tree, 'id', 'com.app:id/footer');
    expect(r.nodes).to.have.lengthOf(1);
  });

  it('matches class name on full and short type', () => {
    expect(matchSelector(tree, 'class name', 'XCUIElementTypeButton').nodes).to.have.lengthOf(2);
    expect(matchSelector(tree, 'class name', 'XCUIElementTypeWindow').nodes).to.have.lengthOf(1);
  });

  it('walks a positional xpath to a unique node', () => {
    const xp =
      '/XCUIElementTypeApplication[1]/XCUIElementTypeWindow[1]/XCUIElementTypeOther[1]/XCUIElementTypeButton[2]';
    const r = matchSelector(tree, 'xpath', xp);
    expect(r.kind).to.equal('matched');
    expect(r.nodes).to.have.lengthOf(1);
    expect(r.nodes[0].attributes.label).to.equal('Submit');
  });

  it('returns empty when positional xpath misses', () => {
    const xp = '/XCUIElementTypeApplication[1]/XCUIElementTypeWindow[1]/XCUIElementTypeOther[9]';
    const r = matchSelector(tree, 'xpath', xp);
    expect(r.nodes).to.have.lengthOf(0);
  });

  it('handles simple attribute xpath //Tag[@attr="val"]', () => {
    const r = matchSelector(tree, 'xpath', '//XCUIElementTypeButton[@name="login-submit"]');
    expect(r.kind).to.equal('matched');
    expect(r.nodes).to.have.lengthOf(2);
  });

  it('flags complex xpath as unsupported', () => {
    const r = matchSelector(tree, 'xpath', '//Button[contains(@text, "Submit") and @enabled="true"]');
    expect(r.kind).to.equal('unsupported');
  });

  it('matches simple iOS class chain with predicate', () => {
    const r = matchSelector(
      tree,
      '-ios class chain',
      '**/XCUIElementTypeButton[`name == "login-submit"`]',
    );
    expect(r.kind).to.equal('matched');
    expect(r.nodes).to.have.lengthOf(2);
  });

  it('matches iOS class chain with index', () => {
    const r = matchSelector(tree, '-ios class chain', '**/XCUIElementTypeButton[2]');
    expect(r.nodes).to.have.lengthOf(1);
  });

  it('matches single-AND iOS predicate', () => {
    const r = matchSelector(
      tree,
      '-ios predicate string',
      'type == "XCUIElementTypeButton" AND label == "Submit"',
    );
    expect(r.kind).to.equal('matched');
    expect(r.nodes).to.have.lengthOf(2);
  });

  it('flags predicate with non-equality operator as unsupported', () => {
    const r = matchSelector(
      tree,
      '-ios predicate string',
      'label CONTAINS "Sub"',
    );
    expect(r.kind).to.equal('unsupported');
  });

  it('flags unknown strategy as unsupported', () => {
    const r = matchSelector(tree, '-android uiautomator', 'new UiSelector().resourceId("x")');
    expect(r.kind).to.equal('unsupported');
  });
});
