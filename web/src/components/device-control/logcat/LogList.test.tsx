import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LogList, type LogListHandle, type LogListProps } from './LogList';
import { NO_SELECTION, type LogSelection } from './logSelection';
import { installFakeLayout, settle, userScroll, type FakeLayout } from './testing/fakeLayout';
import type { BufferedLogcatRecord } from './useLogcatStream';

const lines = (n: number, from = 0): BufferedLogcatRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    seq: from + i,
    ts: Date.UTC(2026, 9, 3, 10, 0, 0) + (from + i) * 10,
    pid: 1,
    tid: 1,
    level: 'I',
    tag: 'Tag',
    pkg: 'com.example',
    message: `line ${from + i}`,
  }));

function Harness(props: Partial<LogListProps> & { listRef?: React.Ref<LogListHandle> }) {
  const [selection, setSelection] = React.useState<LogSelection>(NO_SELECTION);
  const { listRef, ...rest } = props;
  const records = rest.records ?? lines(50);
  return (
    <LogList
      ref={listRef}
      records={records}
      oldestSeq={records.length ? records[0].seq : null}
      wrap
      find=""
      caseSensitive={false}
      hits={new Set()}
      activeHit={null}
      following
      newLines={0}
      onPause={() => {}}
      onFollow={() => {}}
      selection={selection}
      onSelect={(next) => setSelection(next)}
      onOpenDetails={() => {}}
      onCopy={() => {}}
      {...rest}
    />
  );
}

const list = () => screen.getByRole('listbox', { name: 'Log lines' });
const posinsets = () =>
  screen.getAllByRole('option').map((o) => Number(o.getAttribute('aria-posinset')));
const top = (el: HTMLElement) =>
  Number(/translateY\(([-\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);
/** The first row on screen: its seq and how far its top sits from the list's top. */
const firstOnScreen = () => {
  const scrollTop = list().scrollTop;
  const rows = screen.getAllByRole('option').sort((a, b) => top(a) - top(b));
  const first = rows.find((r) => top(r) + r.offsetHeight > scrollTop);
  if (!first) throw new Error('no row on screen');
  return { seq: first.getAttribute('data-seq'), offset: top(first) - scrollTop };
};
const bottom = () => list().scrollHeight - list().clientHeight;

describe('LogList: rows, following and pausing', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 400 });
  });
  afterEach(() => layout.restore());

  it('renders only the rows on screen out of 5,000, each saying where it is', async () => {
    render(<Harness records={lines(5000)} />);
    await settle();
    const rows = screen.getAllByRole('option');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    rows.forEach((r) => expect(r).toHaveAttribute('aria-setsize', '5000'));
    // Following: the newest line is on screen.
    expect(posinsets()).toContain(5000);
  });

  it('is a named list of lines, several of which may be selected', () => {
    render(<Harness />);
    expect(list()).toHaveAttribute('aria-multiselectable', 'true');
    expect(list()).toHaveAttribute('tabindex', '0');
  });

  it('follows new lines, and its own scrolls never pause it', async () => {
    const onPause = vi.fn();
    const { rerender } = render(<Harness records={lines(500)} onPause={onPause} />);
    await settle();
    for (const n of [520, 540, 560]) {
      rerender(<Harness records={lines(n)} onPause={onPause} />);
      await settle();
    }
    expect(posinsets()).toContain(560);
    expect(list().scrollTop).toBe(bottom());
    expect(onPause).not.toHaveBeenCalled();
  });

  it('pauses when the user scrolls up more than 24 px from the bottom', async () => {
    const onPause = vi.fn();
    render(<Harness records={lines(500)} onPause={onPause} />);
    await settle();
    userScroll(list(), bottom() - 24);
    expect(onPause).not.toHaveBeenCalled();
    userScroll(list(), bottom() - 25);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  // The browser clamping after a filter shrank the list, say: nobody scrolled.
  it('takes no scroll for the user without a wheel, touch, key or scrollbar', async () => {
    const onPause = vi.fn();
    const onFollow = vi.fn();
    const { rerender } = render(
      <Harness records={lines(500)} onPause={onPause} onFollow={onFollow} />,
    );
    await settle();
    list().scrollTop = 0;
    await settle();
    expect(onPause).not.toHaveBeenCalled();
    rerender(
      <Harness records={lines(500)} following={false} onPause={onPause} onFollow={onFollow} />,
    );
    list().scrollTop = bottom();
    await settle();
    expect(onFollow).not.toHaveBeenCalled();
  });

  // A gentle trackpad scroll moves a few pixels per event while lines keep
  // arriving. Following must not pull each small step back to the bottom,
  // or the 24 px are never crossed and the stream wins.
  it('pauses on a slow scroll up while lines keep arriving', async () => {
    const onPause = vi.fn();
    let n = 500;
    const { rerender } = render(<Harness records={lines(n)} onPause={onPause} />);
    await settle();
    for (let step = 0; step < 6; step++) {
      userScroll(list(), list().scrollTop - 6);
      n += 2;
      rerender(<Harness records={lines(n)} onPause={onPause} />);
      await settle();
    }
    expect(onPause).toHaveBeenCalled();
  });

  // Paused at the bottom (the Pause button, say), a small nudge up is still
  // within 24 px: it is a scroll away from the latest, not back to it.
  it('stays paused on a nudge up near the bottom', async () => {
    const onFollow = vi.fn();
    render(<Harness records={lines(500)} following={false} onFollow={onFollow} />);
    await settle();
    userScroll(list(), bottom());
    expect(onFollow).toHaveBeenCalledTimes(1);
    onFollow.mockClear();
    userScroll(list(), bottom() - 10);
    expect(onFollow).not.toHaveBeenCalled();
  });

  it('follows again when the user scrolls back to the bottom', async () => {
    const onFollow = vi.fn();
    render(<Harness records={lines(500)} following={false} onFollow={onFollow} />);
    await settle();
    userScroll(list(), 0);
    expect(onFollow).not.toHaveBeenCalled();
    userScroll(list(), bottom() - 10);
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it('counts the new lines while paused, and Jump to latest follows', () => {
    const onFollow = vi.fn();
    const { rerender } = render(<Harness following={false} newLines={1342} onFollow={onFollow} />);
    fireEvent.click(screen.getByRole('button', { name: '1,342 new lines · Jump to latest' }));
    expect(onFollow).toHaveBeenCalledTimes(1);
    rerender(<Harness following={false} newLines={1} onFollow={onFollow} />);
    expect(screen.getByRole('button', { name: '1 new line · Jump to latest' })).toBeInTheDocument();
    rerender(<Harness following={false} newLines={0} onFollow={onFollow} />);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
    rerender(<Harness following newLines={0} onFollow={onFollow} />);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
  });
});

describe('LogList: keeping the reading place', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    // Wrapped rows of mixed heights: every third line takes two lines.
    layout = installFakeLayout({
      viewportHeight: 400,
      rowHeight: (row) => (Number(row.getAttribute('data-seq')) % 3 === 0 ? 40 : 20),
    });
  });
  afterEach(() => layout.restore());

  it('keeps the first line on screen where it was when the oldest lines are dropped', async () => {
    const { rerender } = render(<Harness records={lines(1000)} following={false} />);
    await settle();
    userScroll(list(), 5000);
    await settle();
    const before = firstOnScreen();
    rerender(<Harness records={lines(1000, 100)} following={false} />);
    await settle();
    expect(firstOnScreen()).toEqual(before);
    expect(screen.queryByText('Older lines were dropped while paused')).toBeNull();
  });

  it('says so when the line being read has itself been dropped, and shows the oldest left', async () => {
    const { rerender } = render(<Harness records={lines(1000)} following={false} />);
    await settle();
    userScroll(list(), 200);
    await settle();
    rerender(<Harness records={lines(1000, 500)} following={false} />);
    await settle();
    expect(screen.getByText('Older lines were dropped while paused')).toBeInTheDocument();
    expect(firstOnScreen().seq).toBe('500');
    rerender(<Harness records={lines(1000, 500)} following />);
    await settle();
    expect(screen.queryByText('Older lines were dropped while paused')).toBeNull();
  });

  // A filter hiding the line is not the buffer dropping it.
  it('says nothing about dropped lines when the line is only filtered out', async () => {
    const all = lines(1000);
    const { rerender } = render(<Harness records={all} following={false} />);
    await settle();
    userScroll(list(), 200);
    await settle();
    rerender(<Harness records={all.filter((r) => r.seq >= 50)} oldestSeq={0} following={false} />);
    await settle();
    expect(screen.queryByText('Older lines were dropped while paused')).toBeNull();
  });
});

describe('LogList: selecting and keys', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 400 });
  });
  afterEach(() => layout.restore());

  const option = (seq: number) =>
    document.querySelector(`[role="option"][data-seq="${seq}"]`) as HTMLElement;
  const selectedSeqs = () =>
    screen
      .getAllByRole('option')
      .filter((o) => o.getAttribute('aria-selected') === 'true')
      .map((o) => Number(o.getAttribute('data-seq')));

  it('selects on click, a range with Shift, and adds or removes one with Cmd or Ctrl', async () => {
    render(<Harness records={lines(10)} following={false} />);
    await settle();
    fireEvent.click(option(3));
    fireEvent.click(option(5), { shiftKey: true });
    expect(selectedSeqs()).toEqual([3, 4, 5]);
    fireEvent.click(option(4), { ctrlKey: true });
    fireEvent.click(option(7), { metaKey: true });
    expect(selectedSeqs()).toEqual([3, 5, 7]);
  });

  // A line clicked while following was carried off screen by the next lines
  // within a second, and a Shift+click then ended on a newer line than the one
  // the user saw. Choosing a line is reading it, so it stops following.
  it('pauses following when a click selects a line, and not when it clears the last one', async () => {
    const onPause = vi.fn();
    render(<Harness records={lines(10)} following onPause={onPause} />);
    await settle();
    fireEvent.click(option(9));
    expect(onPause).toHaveBeenCalledTimes(1);

    onPause.mockClear();
    fireEvent.click(option(9), { metaKey: true });
    expect(selectedSeqs()).toEqual([]);
    expect(onPause).not.toHaveBeenCalled();
  });

  it('tells the parent which line was clicked', async () => {
    const onSelect = vi.fn();
    render(<Harness records={lines(10)} following={false} onSelect={onSelect} />);
    await settle();
    fireEvent.click(option(2));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ active: 2 }),
      expect.objectContaining({ seq: 2 }),
      'click',
    );
  });

  it('copies with Cmd or Ctrl+C when lines are selected', async () => {
    const onCopy = vi.fn();
    render(<Harness records={lines(10)} following={false} onCopy={onCopy} />);
    await settle();
    fireEvent.keyDown(list(), { key: 'c', metaKey: true });
    expect(onCopy).not.toHaveBeenCalled();
    fireEvent.click(option(1));
    fireEvent.keyDown(list(), { key: 'c', metaKey: true });
    fireEvent.keyDown(list(), { key: 'c', ctrlKey: true });
    expect(onCopy).toHaveBeenCalledTimes(2);
  });

  it('leaves Cmd or Ctrl+C to the browser while text is selected', async () => {
    const onCopy = vi.fn();
    render(<Harness records={lines(10)} following={false} onCopy={onCopy} />);
    await settle();
    fireEvent.click(option(1));
    const spy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => 'line 1' } as Selection);
    try {
      fireEvent.keyDown(list(), { key: 'c', metaKey: true });
      expect(onCopy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('moves the active line with the arrows, extends with Shift, and opens details with Enter', async () => {
    const onOpenDetails = vi.fn();
    render(<Harness records={lines(10)} following={false} onOpenDetails={onOpenDetails} />);
    await settle();
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(list()).toHaveAttribute('aria-activedescendant', option(1).id);
    fireEvent.keyDown(list(), { key: 'ArrowDown', shiftKey: true });
    expect(selectedSeqs()).toEqual([1, 2]);
    fireEvent.keyDown(list(), { key: 'Enter' });
    expect(onOpenDetails).toHaveBeenCalledWith(expect.objectContaining({ seq: 2 }));
  });

  it('pauses when the arrows leave the newest line, and End follows again', async () => {
    const onPause = vi.fn();
    const onFollow = vi.fn();
    render(<Harness records={lines(10)} onPause={onPause} onFollow={onFollow} />);
    await settle();
    fireEvent.keyDown(list(), { key: 'ArrowUp' }); // the newest line: still following
    expect(onPause).not.toHaveBeenCalled();
    fireEvent.keyDown(list(), { key: 'ArrowUp' });
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(list(), { key: 'End' });
    expect(onFollow).toHaveBeenCalledTimes(1);
  });
});

describe('LogList: reveal', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 400 });
  });
  afterEach(() => layout.restore());

  it('scrolls a line that is not rendered into view, for Find', async () => {
    const ref = React.createRef<LogListHandle>();
    render(<Harness listRef={ref} records={lines(5000)} following={false} />);
    await settle();
    expect(screen.queryByText('line 4000')).toBeNull();
    act(() => ref.current?.reveal(4000));
    await settle();
    expect(screen.getByText('line 4000')).toBeInTheDocument();
  });

  it('measures its rows again when wrapping is turned off', async () => {
    layout.restore();
    layout = installFakeLayout({
      viewportHeight: 400,
      rowHeight: (row) => (row.closest('.is-nowrap') ? 20 : 40),
    });
    const sizer = () => list().firstElementChild as HTMLElement;
    const { rerender } = render(<Harness records={lines(5)} following={false} />);
    await settle();
    expect(sizer().style.height).toBe('200px');
    rerender(<Harness records={lines(5)} following={false} wrap={false} />);
    await settle();
    expect(sizer().style.height).toBe('100px');
  });

  it('can be focused by the parent', () => {
    const ref = React.createRef<LogListHandle>();
    render(<Harness listRef={ref} />);
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(list());
  });
});
