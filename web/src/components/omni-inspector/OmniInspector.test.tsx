import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    api.getInspectorSnapshot.mockResolvedValueOnce(snapshot('com.app:id/other'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    expect(await screen.findByText('No element selected')).toBeInTheDocument();
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
    expect(sep).toHaveAttribute('aria-valuenow', sep.getAttribute('aria-valuemax')!);
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(sep).toHaveAttribute('aria-valuenow', sep.getAttribute('aria-valuemin')!);
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
