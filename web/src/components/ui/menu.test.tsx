import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Menu, MenuItem, MenuDivider } from './Menu';

const flush = () => new Promise((r) => setTimeout(r, 0));

function Harness({ onFirst = vi.fn(), onSecond = vi.fn(), secondDisabled = false }) {
  return (
    <Menu>
      <MenuItem onClick={onFirst}>first</MenuItem>
      <MenuItem onClick={onSecond} disabled={secondDisabled}>
        second
      </MenuItem>
      <MenuDivider />
      <MenuItem onClick={() => {}}>third</MenuItem>
    </Menu>
  );
}

describe('Menu', () => {
  it('container has role="menu"', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('each MenuItem has role="menuitem"', () => {
    render(<Harness />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
  });

  it('ArrowDown from first moves focus to second', async () => {
    render(<Harness />);
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    await flush();
    expect(document.activeElement).toBe(items[1]);
  });

  it('ArrowUp from first loops to last', async () => {
    render(<Harness />);
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    await flush();
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('Home and End jump to first and last', async () => {
    render(<Harness />);
    const items = screen.getAllByRole('menuitem');
    items[1].focus();
    fireEvent.keyDown(items[1], { key: 'End' });
    await flush();
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    await flush();
    expect(document.activeElement).toBe(items[0]);
  });

  it('ArrowDown skips a disabled item', async () => {
    render(<Harness secondDisabled />);
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    await flush();
    expect(document.activeElement).toBe(items[2]);
  });

  it('Enter on focused item invokes its onClick', () => {
    const onFirst = vi.fn();
    render(<Harness onFirst={onFirst} />);
    const items = screen.getAllByRole('menuitem');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'Enter' });
    fireEvent.click(items[0]);
    expect(onFirst).toHaveBeenCalled();
  });
});
