import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectorNode, InspectorSnapshot } from './OmniInspector';

const api = vi.hoisted(() => ({
  getInspectorSnapshot: vi.fn(),
  getAppiumSession: vi.fn(),
}));
vi.mock('../../api-service', () => ({ default: api }));

import OmniInspector from './OmniInspector';

function button(id: string): InspectorNode {
  return {
    name: '',
    type: 'android.widget.Button',
    text: id.split('/').pop(),
    rect: { x: 10, y: 10, width: 200, height: 60 },
    xpath: `/hierarchy/${id}`,
    suggestedLocators: [{ strategy: 'id', value: id, unique: true, score: 0 }],
    suggestedActions: [],
    children: [],
    attributes: { clickable: 'true', enabled: 'true', 'resource-id': id },
  };
}

function snapshot(id = 'com.app:id/login'): InspectorSnapshot {
  return {
    udid: 'U1',
    platform: 'android',
    timestamp: new Date().toISOString(),
    screenshot: '',
    hierarchySource: 'device',
    metadata: { screenWidth: 1080, screenHeight: 2220 },
    hierarchy: {
      name: '',
      type: 'hierarchy',
      rect: { x: 0, y: 0, width: 1080, height: 2220 },
      xpath: '/',
      suggestedLocators: [],
      suggestedActions: [],
      attributes: {},
      children: [button(id)],
    },
  };
}

// The deep-search fixture: four FrameLayout levels, each with a sibling
// button before the chain so the wrappers don't fold (a plain wrapper needs
// exactly one child), the mic sits below the three levels that open by
// default, and — since hit areas are pushed in document order and the mic is
// the last leaf reached by that walk — it is the last one drawn.
function deepSnapshot(): InspectorSnapshot {
  const deep = snapshot();
  const leaf = {
    ...button('com.app:id/mic'),
    text: '',
    attributes: { clickable: 'true', 'content-desc': 'Voice search' },
  };
  const wrap = (child: InspectorNode, depth: number): InspectorNode => ({
    name: '',
    type: 'android.widget.FrameLayout',
    rect: { x: 0, y: 0, width: 1080, height: 2220 },
    xpath: `/hierarchy/level${depth}`,
    suggestedLocators: [],
    suggestedActions: [],
    attributes: {},
    children: [button(`com.app:id/sib${depth}`), child],
  });
  deep.hierarchy.children = [wrap(wrap(wrap(wrap(leaf, 4), 3), 2), 1)];
  return deep;
}

const STALE = 'The screen may have changed since this capture.';

beforeEach(() => {
  vi.clearAllMocks();
  api.getInspectorSnapshot.mockResolvedValue(snapshot());
  api.getAppiumSession.mockResolvedValue({});
});

describe('OmniInspector — Checks', () => {
  // "AI Insight" ran rules in the browser; nothing in it was AI.
  it('shows Checks, not AI Insight, with a summary and one row per check', async () => {
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
    expect(screen.queryByRole('tab', { name: /AI Insight/i })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Checks' }));
    expect(screen.getByText(/\d+ passed/)).toBeInTheDocument();
    expect(screen.getByText('Unique locator')).toBeInTheDocument();
    expect(screen.getByText('id com.app:id/login matches only this element')).toBeInTheDocument();
    expect(screen.queryByText('Quick Facts')).toBeNull();
  });
});

describe('OmniInspector — stale capture', () => {
  it('says when an input may have changed the screen, and Refresh captures again', async () => {
    const { rerender } = render(<OmniInspector udid="U1" embedded deviceActionAt={0} />);
    await screen.findByRole('treeitem', { name: /login/ });
    expect(screen.getByText(/^Captured /)).toBeInTheDocument();
    expect(screen.queryByText(STALE)).toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    rerender(<OmniInspector udid="U1" embedded deviceActionAt={Date.now()} />);
    const banner = screen.getByText(STALE).closest('[role="status"]') as HTMLElement;
    expect(banner).not.toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    fireEvent.click(within(banner).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.getInspectorSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(STALE)).toBeNull());
  });
});

describe('OmniInspector — refresh race', () => {
  // A slow capture of the previous device must not replace the current one.
  it('keeps the newest capture when an older request answers late', async () => {
    let answerFirst: (v: InspectorSnapshot) => void = () => {};
    api.getInspectorSnapshot
      .mockImplementationOnce(() => new Promise((r) => (answerFirst = r)))
      .mockResolvedValueOnce(snapshot('com.app:id/second'));
    const { rerender } = render(<OmniInspector udid="U1" embedded />);
    rerender(<OmniInspector udid="U2" embedded />);
    await screen.findByRole('treeitem', { name: /second/ });
    answerFirst(snapshot('com.app:id/first'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('treeitem', { name: /first/ })).toBeNull();
    expect(screen.getByRole('treeitem', { name: /second/ })).toBeInTheDocument();
  });
});

describe('OmniInspector — names', () => {
  it('names the tree header’s icon buttons', async () => {
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('treeitem', { name: /login/ });
    for (const name of ['Expand all', 'Collapse all', 'Refresh snapshot']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /^(Inspect|Interact) mode/ })).toBeInTheDocument();
  });

  it('names each locator’s icon buttons', async () => {
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
    for (const name of [
      'Test locator',
      'Verify with Appium',
      'Find and tap with Appium',
      'Copy locator',
    ]) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
  });
});

describe('OmniInspector — search', () => {
  // A match deep in a collapsed branch stayed hidden: search filtered the tree
  // but didn't open the branches that led to the match.
  it('opens the branches that lead to a match', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByText(/^Captured /);
    expect(screen.queryByText('Voice search')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search elements' }), {
      target: { value: 'Voice' },
    });
    expect(await screen.findByText('Voice search')).toBeInTheDocument();
  });
});

describe('OmniInspector — tree', () => {
  it('renders the element tree with the count in the capture line', async () => {
    render(<OmniInspector udid="U1" embedded />);
    expect(await screen.findByRole('tree', { name: 'Element tree' })).toBeInTheDocument();
    expect(screen.getByText('2 elements')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search elements' })).toHaveAttribute(
      'placeholder',
      'Search elements',
    );
  });

  it('counts matches under the search box', async () => {
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    const box = screen.getByRole('textbox', { name: 'Search elements' });
    fireEvent.change(box, { target: { value: 'login' } });
    expect(screen.getByText(/^1 match · try a role/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText(/^No matches · try a role/)).toBeInTheDocument();
  });

  // A live region that mounts with its first text is often not announced,
  // and one holding the tip re-read it on every keystroke.
  it('announces only the match count, from a status that is always there', async () => {
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('');
    const box = screen.getByRole('textbox', { name: 'Search elements' });
    fireEvent.change(box, { target: { value: 'login' } });
    expect(screen.getByRole('status')).toBe(live);
    expect(live.textContent).toBe('1 match');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(live.textContent).toBe('No matches');
    fireEvent.change(box, { target: { value: '' } });
    expect(live.textContent).toBe('');
  });

  it('keeps a node selected from search visible after the search is cleared', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    const box = screen.getByRole('textbox', { name: 'Search elements' });
    fireEvent.change(box, { target: { value: 'Voice' } });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Voice search/ }));
    fireEvent.change(box, { target: { value: '' } });
    expect(screen.getByRole('treeitem', { name: /Voice search/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('reveals a node picked on the phone', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    const target = document.createElement('div');
    document.body.appendChild(target);
    render(<OmniInspector udid="U1" embedded overlayTarget={target} />);
    await screen.findByRole('tree');
    expect(screen.queryByRole('treeitem', { name: /Voice search/ })).toBeNull();
    // The mic is the deepest leaf, so its hit area is drawn last.
    const areas = target.querySelectorAll('.omni-hit-area');
    fireEvent.click(areas[areas.length - 1]);
    expect(await screen.findByRole('treeitem', { name: /Voice search/ })).toBeInTheDocument();
    target.remove();
  });

  it('follows the selection’s xpath into a new capture, and clears it when gone', async () => {
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
    const renamed = snapshot();
    renamed.hierarchy.children[0].text = 'Sign in';
    api.getInspectorSnapshot.mockResolvedValueOnce(renamed);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    expect(await screen.findByRole('treeitem', { name: /Sign in/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The row is selected by xpath either way; Info shows the node object, so
    // only this proves the selection is the new capture's node.
    expect(screen.getByText('Sign in', { selector: '.omni-info-value' })).toBeInTheDocument();
    api.getInspectorSnapshot.mockResolvedValueOnce(snapshot('com.app:id/other'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    expect(await screen.findByText('No element selected')).toBeInTheDocument();
  });
});

describe('OmniInspector — Test locator', () => {
  // Device control draws the phone itself, so this component's own <img>
  // never loads there; the outline must not wait for its size.
  it('outlines the matching element on the phone', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    try {
      render(<OmniInspector udid="U1" embedded overlayTarget={target} />);
      fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Test locator' }));
      expect(target.querySelectorAll('.omni-frame-match.unique')).toHaveLength(1);
    } finally {
      target.remove();
    }
  });
});

describe('OmniInspector — another device', () => {
  // The same xpath on another device is an unrelated element.
  it('clears the selection instead of following its xpath', async () => {
    const { rerender } = render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
    const other = snapshot();
    other.udid = 'U2';
    api.getInspectorSnapshot.mockResolvedValueOnce(other);
    rerender(<OmniInspector udid="U2" embedded />);
    expect(await screen.findByText('No element selected')).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /login/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});

describe('OmniInspector — Code gen', () => {
  // Every locator for a node: its id first (the best), then an xpath.
  function withXpath(snap: InspectorSnapshot, value: string): InspectorSnapshot {
    snap.hierarchy.children.forEach((b) =>
      b.suggestedLocators.push({ strategy: 'xpath', value, unique: true, score: 0 }),
    );
    return snap;
  }
  function twoButtons(value: string): InspectorSnapshot {
    const snap = snapshot();
    snap.hierarchy.children.push(button('com.app:id/other'));
    return withXpath(snap, value);
  }
  const picker = () => screen.getByRole('combobox') as HTMLSelectElement;
  const refresh = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh snapshot' })).not.toBeDisabled(),
    );
  };

  it('keeps the chosen locator across a Refresh, with the new capture’s value', async () => {
    api.getInspectorSnapshot.mockResolvedValue(twoButtons('//old'));
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Code gen' }));
    expect(picker().value).toBe('id');
    fireEvent.change(picker(), { target: { value: 'xpath' } });
    expect(screen.getByText(/\/\/old/)).toBeInTheDocument();

    api.getInspectorSnapshot.mockResolvedValue(twoButtons('//new'));
    await refresh();
    expect(picker().value).toBe('xpath');
    expect(screen.getByText(/\/\/new/)).toBeInTheDocument();
    expect(screen.queryByText(/\/\/old/)).toBeNull();
  });

  it('goes back to the best locator for another element, or when the choice is gone', async () => {
    api.getInspectorSnapshot.mockResolvedValue(twoButtons('//x'));
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Code gen' }));
    fireEvent.change(picker(), { target: { value: 'xpath' } });
    // Another element, which also offers an xpath: its best, not the last choice.
    fireEvent.click(screen.getByRole('treeitem', { name: /other/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Code gen' }));
    expect(picker().value).toBe('id');

    fireEvent.change(picker(), { target: { value: 'xpath' } });
    const idOnly = snapshot();
    idOnly.hierarchy.children.push(button('com.app:id/other'));
    api.getInspectorSnapshot.mockResolvedValue(idOnly);
    await refresh();
    expect(picker().value).toBe('id');
  });
});

describe('OmniInspector — the selected row scrolls into view', () => {
  // jsdom has no scrollIntoView; record which elements are asked to scroll.
  const hadScroll = 'scrollIntoView' in Element.prototype;
  const originalScroll = Element.prototype.scrollIntoView;
  let scrolled: Element[] = [];
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
  });
  afterEach(() => {
    if (hadScroll) Element.prototype.scrollIntoView = originalScroll;
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('after the search is cleared', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search elements' }), {
      target: { value: 'Voice' },
    });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Voice search/ }));
    scrolled = [];
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(scrolled).toContain(screen.getByRole('treeitem', { name: /Voice search/ }));
  });

  it('after Refresh', async () => {
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /login/ }));
    scrolled = [];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    await waitFor(() => expect(api.getInspectorSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(scrolled).toContain(screen.getByRole('treeitem', { name: /login/ })),
    );
  });

  it('when the selected node is picked on the phone again after its row was hidden', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    const target = document.createElement('div');
    document.body.appendChild(target);
    render(<OmniInspector udid="U1" embedded overlayTarget={target} />);
    await screen.findByRole('tree');
    const mic = () => {
      const areas = target.querySelectorAll('.omni-hit-area');
      return areas[areas.length - 1];
    };
    fireEvent.click(mic());
    await screen.findByRole('treeitem', { name: /Voice search/ });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('treeitem', { name: /Voice search/ })).toBeNull();
    scrolled = [];
    fireEvent.click(mic());
    const row = await screen.findByRole('treeitem', { name: /Voice search/ });
    expect(scrolled).toContain(row);
    target.remove();
  });
});

describe('OmniInspector — divider', () => {
  beforeEach(() => localStorage.removeItem('xenon.omni.split'));

  it('resizes the tree from the keyboard, remembers it, and resets on double-click', async () => {
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    const sep = screen.getByRole('separator', { name: 'Resize element tree' });
    expect(sep).toHaveAttribute('aria-valuenow', '40');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(sep).toHaveAttribute('aria-valuenow', '42');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sep).toHaveAttribute('aria-valuenow', '38');
    expect(localStorage.getItem('xenon.omni.split')).toBe('0.38');
    fireEvent.keyDown(sep, { key: 'End' });
    expect(sep).toHaveAttribute('aria-valuenow', sep.getAttribute('aria-valuemax') as string);
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(sep).toHaveAttribute('aria-valuenow', sep.getAttribute('aria-valuemin') as string);
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute('aria-valuenow', '40');
  });

  it('starts from the remembered share', async () => {
    localStorage.setItem('xenon.omni.split', '0.5');
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '50');
  });
});

describe('OmniInspector — breadcrumb', () => {
  it('shows the path, folds early ancestors, and selects one when clicked', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search elements' }), {
      target: { value: 'Voice' },
    });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Voice search/ }));
    const nav = screen.getByRole('navigation', { name: 'Element path' });
    expect(within(nav).getByText('Voice search')).toHaveAttribute('aria-current', 'location');
    // hierarchy, level1…level4: five ancestors, so the first one folds away.
    expect(within(nav).queryByRole('button', { name: 'hierarchy' })).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: 'Show all 5 ancestors' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'hierarchy' }));
    expect(screen.getByRole('treeitem', { name: /hierarchy/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  // A crumb cuts its name off at 16ch; the tooltip has the whole node.
  it('gives each crumb the node’s full type, resource id and text', async () => {
    const snap = snapshot();
    const login = snap.hierarchy.children[0];
    login.children = [{ ...button('com.app:id/badge'), xpath: `${login.xpath}/badge` }];
    api.getInspectorSnapshot.mockResolvedValue(snap);
    render(<OmniInspector udid="U1" embedded />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /badge/ }));
    const nav = screen.getByRole('navigation', { name: 'Element path' });
    expect(within(nav).getByRole('button', { name: 'login' })).toHaveAttribute(
      'title',
      'android.widget.Button\ncom.app:id/login\nlogin',
    );
    expect(nav.querySelector('[aria-current="location"]')).toHaveAttribute(
      'title',
      'android.widget.Button\ncom.app:id/badge\nbadge',
    );
  });

  // The breadcrumb is the keyboard's way to a node in the middle of a folded
  // row, so neither of its buttons may drop focus to <body> (WCAG 2.4.3).
  it('keeps keyboard focus in the breadcrumb', async () => {
    api.getInspectorSnapshot.mockResolvedValue(deepSnapshot());
    render(<OmniInspector udid="U1" embedded />);
    await screen.findByRole('tree');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search elements' }), {
      target: { value: 'Voice' },
    });
    const row = await screen.findByRole('treeitem', { name: /Voice search/ });
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    // Selecting from the tree leaves focus in the tree.
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /Voice search/ }));

    let nav = screen.getByRole('navigation', { name: 'Element path' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Show all 5 ancestors' }));
    // "…" is gone; focus moves to the first ancestor it revealed.
    expect(document.activeElement).toBe(within(nav).getByRole('button', { name: 'hierarchy' }));

    // level2's crumb: hierarchy, level1, level2, … — all but the root are FrameLayouts.
    fireEvent.click(within(nav).getAllByRole('button', { name: 'FrameLayout' })[1]);
    nav = screen.getByRole('navigation', { name: 'Element path' });
    const current = nav.querySelector('[aria-current="location"]');
    expect(current).not.toBeNull();
    expect(document.activeElement).toBe(current);
    expect(within(nav).getAllByRole('button')).toHaveLength(2);
  });
});
