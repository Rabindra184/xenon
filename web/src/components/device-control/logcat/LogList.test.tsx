import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  const first = rows.find((r) => top(r) + r.offsetHeight > scrollTop)!;
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
    const { rerender } = render(
      <Harness following={false} newLines={1342} onFollow={onFollow} />,
    );
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
    rerender(
      <Harness records={all.filter((r) => r.seq >= 50)} oldestSeq={0} following={false} />,
    );
    await settle();
    expect(screen.queryByText('Older lines were dropped while paused')).toBeNull();
  });
});
