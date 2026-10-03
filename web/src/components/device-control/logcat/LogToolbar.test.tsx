import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LogToolbar, type LogToolbarProps } from './LogToolbar';

const props = (over: Partial<LogToolbarProps> = {}): LogToolbarProps => ({
  status: 'Live',
  query: '',
  onQueryChange: vi.fn(),
  filterRef: React.createRef(),
  find: '',
  onFindChange: vi.fn(),
  findRef: React.createRef(),
  hitCount: 0,
  activeHit: 0,
  onStep: vi.fn(),
  following: true,
  onTogglePause: vi.fn(),
  recording: false,
  recordedLines: 0,
  onToggleRecording: vi.fn(),
  onExport: vi.fn(),
  caseSensitive: false,
  onToggleCase: vi.fn(),
  wrap: true,
  onToggleWrap: vi.fn(),
  canCopySelected: false,
  onCopySelected: vi.fn(),
  onClearLines: vi.fn(),
  ...over,
});
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More options' }));

describe('LogToolbar', () => {
  it('shows the stream status in a live region, its dot red when it gave up', () => {
    const { container, rerender } = render(<LogToolbar {...props()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    expect(container.querySelector('.log-live-dot.active')).toBeTruthy();
    rerender(<LogToolbar {...props({ status: 'Offline' })} />);
    expect(container.querySelector('.log-live-dot.is-error')).toBeTruthy();
    rerender(<LogToolbar {...props({ status: 'Connecting' })} />);
    expect(container.querySelector('.log-live-dot.is-error')).toBeNull();
  });

  it('filters as you type, and × clears it only when there is text', () => {
    const p = props();
    const { rerender } = render(<LogToolbar {...p} />);
    expect(screen.getByLabelText('Filter logs')).toHaveAttribute(
      'placeholder',
      'tag:Wifi package:com.example text',
    );
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:Wifi' } });
    expect(p.onQueryChange).toHaveBeenCalledWith('tag:Wifi');
    expect(screen.queryByLabelText('Clear filter')).toBeNull();
    rerender(<LogToolbar {...p} query="tag:Wifi" />);
    fireEvent.click(screen.getByLabelText('Clear filter'));
    expect(p.onQueryChange).toHaveBeenLastCalledWith('');
  });

  it('explains the filter syntax from the ? button', () => {
    render(<LogToolbar {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter syntax' }));
    const dialog = screen.getByRole('dialog');
    ['tag:Wifi', 'package:com.example', 'level:W', '-tag:chatty', 'hide a tag'].forEach((t) =>
      expect(dialog).toHaveTextContent(t),
    );
  });

  it('steps through matches with the buttons, Enter and Shift+Enter, and shows the count', () => {
    const p = props({ find: 'anr', hitCount: 12, activeHit: 2 });
    render(<LogToolbar {...p} />);
    expect(screen.getByText('3/12')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next match'));
    fireEvent.click(screen.getByLabelText('Previous match'));
    fireEvent.keyDown(screen.getByLabelText('Find in logs'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('Find in logs'), { key: 'Enter', shiftKey: true });
    expect((p.onStep as ReturnType<typeof vi.fn>).mock.calls).toEqual([[1], [-1], [1], [-1]]);
  });

  it('reports 0/0 and disables the steps with no match', () => {
    render(<LogToolbar {...props({ find: 'zzz' })} />);
    expect(screen.getByText('0/0')).toBeInTheDocument();
    expect(screen.getByLabelText('Next match')).toBeDisabled();
    expect(screen.getByLabelText('Previous match')).toBeDisabled();
  });

  it('reads Pause while following and Resume while paused', () => {
    const p = props();
    const { rerender } = render(<LogToolbar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(p.onTogglePause).toHaveBeenCalledTimes(1);
    rerender(<LogToolbar {...p} following={false} />);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('reads Stop with the line count while recording', () => {
    render(<LogToolbar {...props({ recording: true, recordedLines: 1204 })} />);
    const btn = screen.getByRole('button', { name: /Stop · 1,204 lines/ });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveClass('is-recording');
  });

  it('has an Export icon button that is never disabled', () => {
    const p = props();
    render(<LogToolbar {...p} />);
    const btn = screen.getByRole('button', { name: 'Export shown lines' });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(p.onExport).toHaveBeenCalledTimes(1);
  });

  it('toggles Match case and Wrap long lines from the menu', () => {
    const p = props({ caseSensitive: true });
    render(<LogToolbar {...p} />);
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Match case' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Match case' }));
    expect(p.onToggleCase).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' }));
    expect(p.onToggleWrap).toHaveBeenCalledTimes(1);
  });

  it('offers Copy selected lines only with a selection, and Clear lines', () => {
    const p = props();
    const { rerender } = render(<LogToolbar {...p} />);
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Copy selected lines' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear lines' }));
    expect(p.onClearLines).toHaveBeenCalledTimes(1);
    rerender(<LogToolbar {...p} canCopySelected />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy selected lines' }));
    expect(p.onCopySelected).toHaveBeenCalledTimes(1);
  });

  it('fills nothing green', () => {
    const { container } = render(<LogToolbar {...props()} />);
    expect(container.querySelector('.btn-primary')).toBeNull();
  });
});
