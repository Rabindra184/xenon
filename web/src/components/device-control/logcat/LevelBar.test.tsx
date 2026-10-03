import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LevelBar, type LevelBarProps } from './LevelBar';

const counts = { V: 300, D: 1200, I: 900, W: 117, E: 51, F: 0 };
const bar = (over: Partial<LevelBarProps> = {}) =>
  render(
    <LevelBar
      platform="android"
      counts={counts}
      minLevel={undefined}
      shown={168}
      total={2629}
      onChoose={vi.fn()}
      {...over}
    />,
  );
const names = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));

describe('LevelBar', () => {
  it('names each Android level for what it does, with its count', () => {
    bar();
    expect(screen.getByRole('group', { name: 'Log levels' })).toBeInTheDocument();
    expect(names()).toEqual([
      'All levels',
      'Verbose and above, 300 verbose lines',
      'Debug and above, 1,200 debug lines',
      'Info and above, 900 info lines',
      'Warning and above, 117 warning lines',
      'Error and above, 51 error lines',
    ]);
  });

  it('adds Fatal only when there is one, named for what it selects', () => {
    bar({ counts: { ...counts, F: 1 } });
    expect(names()).toContain('Fatal only, 1 fatal line');
  });

  it('offers the iOS levels', () => {
    bar({ platform: 'ios', counts: { ...counts, F: 2 } });
    expect(names()).toEqual([
      'All levels',
      'Debug and above, 1,200 debug lines',
      'Info and above, 900 info lines',
      'Error and above, 51 error lines',
      'Fault only, 2 fault lines',
    ]);
  });

  it('presses the chosen level and tints the levels it includes', () => {
    bar({ minLevel: 'W' });
    expect(screen.getByRole('button', { name: /^Warning/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All levels' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: /^Error/ })).toHaveClass('is-included');
    expect(screen.getByRole('button', { name: /^Info/ })).not.toHaveClass('is-included');
  });

  it('presses All for a typo, and the shown level for one iOS has no button for', () => {
    const { unmount } = bar({ minLevel: 'X' });
    expect(screen.getByRole('button', { name: 'All levels' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    unmount();
    bar({ platform: 'ios', minLevel: 'W' });
    expect(screen.getByRole('button', { name: /^Error/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks for a level, for no level again when it is chosen, and for none from All', () => {
    const onChoose = vi.fn();
    const { rerender } = bar({ onChoose });
    fireEvent.click(screen.getByRole('button', { name: /^Warning/ }));
    expect(onChoose).toHaveBeenLastCalledWith('W');
    rerender(
      <LevelBar
        platform="android"
        counts={counts}
        minLevel="W"
        shown={1}
        total={2}
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Warning/ }));
    expect(onChoose).toHaveBeenLastCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: 'All levels' }));
    expect(onChoose).toHaveBeenLastCalledWith('');
  });

  it('says how many lines are shown', () => {
    bar();
    expect(screen.getByText('168 of 2,629 shown')).toBeInTheDocument();
  });
});
