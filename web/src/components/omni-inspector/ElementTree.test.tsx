import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InspectorNode } from './OmniInspector';
import ElementTree from './ElementTree';
import { visibleRows } from './treeRows';

function el(xpath: string, over: Partial<InspectorNode> = {}, children: InspectorNode[] = []) {
  return {
    name: '',
    type: 'android.widget.FrameLayout',
    rect: { x: 0, y: 0, width: 100, height: 100 },
    xpath,
    suggestedLocators: [],
    suggestedActions: [],
    attributes: {},
    children,
    ...over,
  } as InspectorNode;
}
const btn = (xpath: string, text: string) =>
  el(xpath, { type: 'android.widget.Button', text, attributes: { clickable: 'true' } });

// hierarchy › content (folded) › list [ One, Two, card › [ Three, Four ] ]
const card = el('/h/c/l/card', { attributes: { 'content-desc': 'Card' } }, [
  btn('/h/c/l/card/3', 'Three'),
  btn('/h/c/l/card/4', 'Four'),
]);
const list = el('/h/c/l', { attributes: { scrollable: 'true' } }, [
  btn('/h/c/l/1', 'One'),
  btn('/h/c/l/2', 'Two'),
  card,
]);
const root = el('/h', { type: 'hierarchy' }, [
  el('/h/c', { attributes: { 'resource-id': 'android:id/content' } }, [list]),
]);

function Harness({ onSelect = () => {} }: { onSelect?: (n: InspectorNode) => void }) {
  const [open, setOpen] = React.useState(() => new Set(['/h/c/l']));
  const [selected, setSelected] = React.useState<string | null>(null);
  return (
    <ElementTree
      rows={visibleRows(root, open)}
      selectedXpath={selected}
      hoveredXpath={null}
      matches={new Set()}
      onToggle={(x) =>
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(x)) next.delete(x);
          else next.add(x);
          return next;
        })
      }
      onSelect={(n) => {
        setSelected(n.xpath);
        onSelect(n);
      }}
      onHover={() => {}}
    />
  );
}

const item = (name: RegExp) => screen.getByRole('treeitem', { name });

describe('ElementTree', () => {
  it('is a tree whose rows carry level, size, position and open state', () => {
    render(<Harness />);
    expect(screen.getByRole('tree', { name: 'Element tree' })).toBeInTheDocument();
    const top = item(/content/);
    expect(top).toHaveAttribute('aria-level', '1');
    expect(top).toHaveAttribute('aria-expanded', 'true');
    const two = item(/Two/);
    expect(two).toHaveAttribute('aria-level', '2');
    expect(two).toHaveAttribute('aria-setsize', '3');
    expect(two).toHaveAttribute('aria-posinset', '2');
    expect(two).not.toHaveAttribute('aria-expanded');
    expect(item(/Card/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('folds a wrapper run into one row with a part per node', () => {
    render(<Harness />);
    expect(item(/hierarchy.*content/)).toBeInTheDocument();
  });

  it('names a row in plain words, with the type only when it is shown', () => {
    render(<Harness />);
    // Two's name differs from its type ('Button'), so the type is appended.
    expect(screen.getByRole('treeitem', { name: 'Two, Button' })).toBeInTheDocument();
    // The folded row's target (the list) has no name of its own, so its name
    // falls back to its type ('FrameLayout') — equal to the shown name, so no
    // suffix is appended.
    expect(
      screen.getByRole('treeitem', { name: 'hierarchy, content, FrameLayout' }),
    ).toBeInTheDocument();
  });

  it('has one tab stop', () => {
    render(<Harness />);
    const stops = screen.getAllByRole('treeitem').filter((r) => r.tabIndex === 0);
    expect(stops).toHaveLength(1);
  });

  it('moves the tab stop to a row selected by click', () => {
    render(<Harness />);
    // jsdom's click doesn't move focus, so this exercises the tabIndex-from-
    // selection fallback rather than the roving-focus-from-keyboard path.
    fireEvent.click(item(/Two/));
    const stops = screen.getAllByRole('treeitem').filter((r) => r.tabIndex === 0);
    expect(stops).toEqual([item(/Two/)]);
  });

  it('moves with the arrow keys, Home and End', () => {
    render(<Harness />);
    const top = item(/content/);
    top.focus();
    fireEvent.keyDown(top, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item(/One/));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(item(/Card/));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(top);
  });

  it('opens with → and closes with ←, and ← on a child goes to its parent', () => {
    render(<Harness />);
    const cardRow = item(/Card/);
    cardRow.focus();
    fireEvent.keyDown(cardRow, { key: 'ArrowRight' });
    expect(item(/Card/)).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(item(/Card/), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(item(/Three/));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(item(/Card/));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(item(/Card/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects the row’s target with Enter or Space', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const two = item(/Two/);
    two.focus();
    fireEvent.keyDown(two, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xpath: '/h/c/l/2' }));
    expect(item(/Two/)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(item(/One/), { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xpath: '/h/c/l/1' }));
  });

  it('selects a node in the middle of a run when its part is clicked', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByText('hierarchy'));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xpath: '/h' }));
  });

  it('keeps focus in the tree when the focused row is collapsed away', () => {
    render(<Harness />);
    const three = () => screen.queryByRole('treeitem', { name: /Three/ });
    fireEvent.keyDown(item(/Card/), { key: 'ArrowRight' });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    three()!.focus();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.click(item(/Card/).querySelector('.omni-tree-row__caret')!);
    expect(three()).toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem');
  });
});
