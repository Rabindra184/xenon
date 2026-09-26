import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterMenu, type FilterOption } from './FilterMenu';

type P = 'all' | 'android' | 'ios';
const OPTIONS: FilterOption<P>[] = [
  { value: 'all', label: 'Any platform', count: 5 },
  { value: 'android', label: 'Android', count: 2 },
  { value: 'ios', label: 'iOS', count: 3 },
];

function Harness({ initial = 'all' as P, onChange = vi.fn() }) {
  const [value, setValue] = React.useState<P>(initial);
  return (
    <FilterMenu<P>
      name="Platform"
      value={value}
      anyValue="all"
      options={OPTIONS}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
    />
  );
}

describe('FilterMenu', () => {
  it('reads as an add-filter button while unset', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Platform' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Clear platform filter' })).toBeNull();
  });

  it('shows the choice once set, and × clears it', () => {
    const onChange = vi.fn();
    render(<Harness initial="ios" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Platform: iOS' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear platform filter' }));
    expect(onChange).toHaveBeenCalledWith('all');
    expect(screen.getByRole('button', { name: 'Platform' })).toHaveFocus();
  });

  it('opens a single-choice menu with counts, focused on the current choice', async () => {
    render(<Harness initial="ios" />);
    fireEvent.click(screen.getByRole('button', { name: 'Platform: iOS' }));
    const ios = await screen.findByRole('menuitemradio', { name: /iOS/ });
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual([
      'Any platform5',
      'Android2',
      'iOS3',
    ]);
    expect(ios).toHaveAttribute('aria-checked', 'true');
    expect(ios).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Platform: iOS' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('choosing closes the menu and returns focus to the trigger', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Android/ }));
    expect(onChange).toHaveBeenCalledWith('android');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Platform: Android' })).toHaveFocus();
  });

  it('Esc closes the menu and returns focus', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    const item = await screen.findByRole('menuitemradio', { name: /Any platform/ });
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Platform' })).toHaveFocus();
  });
});
